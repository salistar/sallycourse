import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import {
  dripPlanInputSchema,
  buildScheduleEntries,
  cadenceLabel,
  isCompleted,
  type DripCadence,
  type DripEntryState,
} from '@sallycourse/shared';
import {
  Course as CourseModel,
  DeploymentSchedule,
  SHORT_CLIP_PLATFORMS,
  connectDb,
  recordAudit,
} from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { isKnownPlatform } from '@/lib/deploy-catalog';
import { extractClientIp } from '@/lib/rate-limit';

/**
 * Déploiements programmés « drip » (P181).
 *
 * POST /api/courses/[id]/deploy-schedule — crée (ou remplace) le plan de
 * publication étalée d'un cours : une cadence par plateforme (immédiat |
 * N/semaine | N/jour pendant M jours). Le worker (cron horaire) exécute ensuite
 * les échéances. Corps validé par le schéma zod partagé.
 *
 * GET — snapshot du plan courant (entrées, cadences, prochaines échéances,
 * avancement, statut). Ownership → 404 (convention repo).
 */

export const dynamic = 'force-dynamic';

/** Plateformes acceptées dans un plan : plateformes de déploiement + clips courts. */
function isAcceptedPlatform(id: string): boolean {
  return isKnownPlatform(id) || (SHORT_CLIP_PLATFORMS as readonly string[]).includes(id);
}

/** Sérialise une entrée persistée pour le snapshot (libellés + état dérivé). */
function serializeEntry(entry: {
  platform: string;
  cadence: { kind: string; count?: number; days?: number };
  cursor?: number;
  nextRunAt?: Date | null;
}) {
  // La validation stricte est faite à la création (schéma zod) : ici la cadence
  // persistée est de forme sûre, on la traite comme une DripCadence.
  const cadence = entry.cadence as DripCadence;
  const state: DripEntryState = {
    platform: entry.platform,
    cadence,
    cursor: entry.cursor ?? 0,
    nextRunAt: entry.nextRunAt ?? null,
  };
  return {
    platform: entry.platform,
    cadence,
    cadenceLabel: cadenceLabel(cadence),
    cursor: entry.cursor ?? 0,
    nextRunAt: entry.nextRunAt ? new Date(entry.nextRunAt).getTime() : null,
    completed: isCompleted(state),
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return apiError('courseNotFound');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('invalidJson');
  }

  const parsed = dripPlanInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Données invalides.', code: 'invalidData', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  // Rejet des plateformes inconnues (ni déploiement, ni clips courts).
  const unknown = parsed.data.entries.map((e) => e.platform).filter((p) => !isAcceptedPlatform(p));
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: `Plateforme(s) inconnue(s) : ${[...new Set(unknown)].join(', ')}.`, code: 'deploySchedulePlatformsUnknown', params: { platforms: [...new Set(unknown)].join(', ') } },
      { status: 400 },
    );
  }

  await connectDb();

  // Ownership → 404 (convention repo).
  const course = await CourseModel.findOne({ _id: id, userId: user.id }).select('_id status').lean();
  if (!course) {
    return apiError('courseNotFound');
  }
  if (course.status !== 'ready' && course.status !== 'published') {
    return NextResponse.json(
      { error: 'Le cours doit être généré (prêt) avant de programmer sa publication.', code: 'courseMustBeReadyToSchedule' },
      { status: 409 },
    );
  }

  const entries = buildScheduleEntries(parsed.data).map((e) => ({
    platform: e.platform,
    cadence: e.cadence,
    cursor: e.cursor,
    nextRunAt: e.nextRunAt ?? undefined,
  }));

  // Un plan par cours : re-création = remplacement (entrées + statut réinitialisés).
  const schedule = await DeploymentSchedule.findOneAndUpdate(
    { courseId: id },
    { $set: { userId: user.id, entries, status: 'active' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  void recordAudit({
    action: 'deployment.created',
    userId: user.id,
    targetType: 'course',
    targetId: id,
    ip: extractClientIp(request),
    userAgent: request.headers.get('user-agent') ?? undefined,
    metadata: { drip: true, platforms: parsed.data.entries.map((e) => e.platform) },
  });

  return NextResponse.json(
    {
      status: schedule.status,
      entries: schedule.entries.map((e) => serializeEntry(e)),
    },
    { status: 201 },
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return apiError('courseNotFound');
  }

  await connectDb();

  const course = await CourseModel.findOne({ _id: id, userId: user.id }).select('_id').lean();
  if (!course) {
    return apiError('courseNotFound');
  }

  const schedule = await DeploymentSchedule.findOne({ courseId: id }).lean();
  if (!schedule) {
    return NextResponse.json({ schedule: null });
  }

  return NextResponse.json({
    schedule: {
      status: schedule.status,
      updatedAt: new Date(schedule.updatedAt).getTime(),
      entries: schedule.entries.map((e) => serializeEntry(e)),
    },
  });
}
