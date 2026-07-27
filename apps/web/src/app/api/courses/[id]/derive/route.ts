import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import {
  PLANS,
  QUEUES,
  defaultJobOptions,
  difficultySchema,
  localeSchema,
  makeJobId,
  outlineSchema,
  type PlanId,
} from '@sallycourse/shared';
import {
  connectDb,
  Course as CourseModel,
  GenerationJob as GenerationJobModel,
} from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { getOutlineQueue } from '@/lib/queues';
import { checkAndReserveCourseQuota, releaseQuota } from '@/lib/quota';

/**
 * POST /api/courses/[id]/derive — décline un cours existant vers une autre
 * langue (traduction du plan + nouveau contenu/TTS/slides) et/ou un autre niveau
 * de difficulté. Réutilise l'outline déjà validé du cours source : clone le
 * Course (status 'generating'), applique le quota mensuel, puis enfile un job
 * outline en mode dérivation (le worker traduit si besoin et lance le contenu).
 *
 * Corps : { targetLocale?, targetDifficulty? } — au moins l'un doit différer de
 * la source. 404 volontaire (pas 403) pour ne pas révéler les cours d'autrui.
 */

const derivePayloadSchema = z
  .object({
    targetLocale: localeSchema.optional(),
    targetDifficulty: difficultySchema.optional(),
  })
  .refine((v) => v.targetLocale !== undefined || v.targetDifficulty !== undefined, {
    message: 'Précisez une langue ou un niveau de difficulté cible.',
  });

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

  const parsed = derivePayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Paramètres de déclinaison invalides.', code: 'invalidVariantParameters', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  await connectDb();

  // Ownership : 404 (pas 403) pour ne pas révéler les cours des autres.
  const source = await CourseModel.findOne({ _id: id, userId: user.id }).lean();
  if (!source) {
    return apiError('courseNotFound');
  }

  // On ne décline qu'un cours dont le plan est validé (outline présent).
  const sourceOutline = outlineSchema.safeParse(source.outline);
  if (!sourceOutline.success) {
    return NextResponse.json(
      { error: 'Ce cours n’a pas encore de plan validé à décliner.', code: 'noValidatedPlanToVary' },
      { status: 409 },
    );
  }

  const targetLocale = parsed.data.targetLocale ?? source.locale;
  const targetDifficulty = parsed.data.targetDifficulty ?? source.difficulty;

  // La cible doit différer de la source sur au moins un axe.
  if (targetLocale === source.locale && targetDifficulty === source.difficulty) {
    return NextResponse.json(
      { error: 'La déclinaison doit changer la langue ou le niveau de difficulté.', code: 'variantMustChangeLanguageOrLevel' },
      { status: 400 },
    );
  }

  // ── Quota mensuel : une déclinaison consomme un crédit (nouveau cours) ──
  const reservation = await checkAndReserveCourseQuota(user.id!);
  if (!reservation.ok) {
    if (reservation.reason === 'user_not_found') {
      return apiError('userNotFound');
    }
    return NextResponse.json(
      {
        error: `Quota mensuel atteint (${reservation.limit} cours/mois du plan ${reservation.plan}).`, code: 'deriveMonthlyQuotaReached', params: { limit: reservation.limit, plan: reservation.plan },
        plan: reservation.plan,
        limit: reservation.limit,
      },
      { status: 402 },
    );
  }

  // Filigrane exigé selon le plan (free=true), comme à la création (P53).
  const plan = (user.plan ?? 'free') as PlanId;
  const watermark = PLANS[plan].watermark;

  // ── Clone du cours : outline source copié tel quel (le worker traduit) ──
  let derived;
  try {
    derived = await CourseModel.create({
      userId: user.id,
      title: source.title,
      difficulty: targetDifficulty,
      locale: targetLocale,
      // Le plan source (validé) est réutilisé ; le worker le traduit si la
      // langue change avant de persister sections/leçons.
      outline: sourceOutline.data,
      targetPlatforms: source.targetPlatforms ?? [],
      ttsVoice: source.ttsVoice,
      watermark,
      status: 'generating',
    });
  } catch {
    await releaseQuota(user.id!);
    return NextResponse.json({ error: 'Création de la déclinaison impossible.', code: 'variantCreationFailed' }, { status: 500 });
  }

  const derivedId = derived._id.toString();

  try {
    await GenerationJobModel.create({
      courseId: derived._id,
      step: QUEUES.outline,
      progress: 0,
    });
    await getOutlineQueue().add(
      'outline',
      { courseId: derivedId, derive: { sourceCourseId: source._id.toString() } },
      { ...defaultJobOptions, jobId: makeJobId(derivedId, QUEUES.outline) },
    );
  } catch {
    await CourseModel.updateOne({ _id: derived._id }, { $set: { status: 'failed' } }).catch(
      () => undefined,
    );
    return NextResponse.json(
      { error: 'Impossible de lancer la déclinaison, réessayez plus tard.', code: 'variantLaunchFailed' },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { id: derivedId, status: derived.status, locale: targetLocale, difficulty: targetDifficulty },
    { status: 202 },
  );
}
