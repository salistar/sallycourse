import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { QUEUES, defaultJobOptions, makeJobId, localeSchema } from '@sallycourse/shared';
import { Course as CourseModel, Deployment, connectDb } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { getDeploymentQueue } from '@/lib/queues';

/**
 * POST /api/courses/[id]/translate — traduction des sous-titres d'un cours
 * DÉJÀ déployé (Prompt 92) : enfile une action 'translate' sur la queue
 * 'deployment' avec les langues cibles + doublage optionnel. Le worker traduit
 * les .srt de chaque leçon vidéo (segment par segment, timestamps conservés),
 * pousse les captions sur chaque plateforme déployée via adapter.addCaptions,
 * et régénère audio+vidéo si `dub` est vrai (Course.dubbedVersions).
 *
 * GET renvoie l'état courant des versions doublées/traduites (dubbedVersions).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const translateSchema = z.object({
  locales: z.array(localeSchema).min(1).max(10),
  dub: z.boolean().optional().default(false),
});

/** Vérifie l'authentification + l'ownership ; renvoie le cours ou une Response d'erreur. */
async function requireOwnedCourse(
  params: Promise<{ id: string }>,
): Promise<{ id: string; userId: string } | Response> {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return apiError('courseNotFound');
  }

  await connectDb();
  const course = await CourseModel.findOne({ _id: id, userId: user.id })
    .select('_id status')
    .lean();
  if (!course) {
    return apiError('courseNotFound');
  }
  return { id, userId: user.id };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const owned = await requireOwnedCourse(params);
  if (owned instanceof Response) return owned;
  const { id: courseId } = owned;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('invalidJson');
  }

  const parsed = translateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Données invalides.', code: 'invalidData', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  // La traduction s'applique à un cours DÉJÀ déployé (au moins une plateforme).
  const deployedCount = await Deployment.countDocuments({ courseId });
  if (deployedCount === 0) {
    return NextResponse.json(
      {
        error: 'Ce cours doit être déployé sur au moins une plateforme avant de le traduire.',
        code: 'not_deployed',
      },
      { status: 409 },
    );
  }

  try {
    const queue = getDeploymentQueue();
    const jobId = makeJobId(courseId, QUEUES.deployment, 'translate');
    await queue.remove(jobId).catch(() => undefined);
    await queue.add(
      'deployment-translate',
      {
        courseId,
        action: 'translate',
        targetLocales: parsed.data.locales,
        dub: parsed.data.dub,
      },
      { ...defaultJobOptions, jobId },
    );
  } catch {
    return NextResponse.json(
      { error: 'Impossible de lancer la traduction, réessayez plus tard.', code: 'cannotStartTranslation' },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { courseId, locales: parsed.data.locales, dub: parsed.data.dub, status: 'queued' },
    { status: 202 },
  );
}

/** GET /api/courses/[id]/translate — état courant des versions doublées/traduites. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const owned = await requireOwnedCourse(params);
  if (owned instanceof Response) return owned;
  const { id: courseId } = owned;

  const course = await CourseModel.findById(courseId).select('dubbedVersions').lean();
  const dubbedVersions = (course?.dubbedVersions ?? []).map((v) => ({
    locale: v.locale,
    status: v.status,
    lessonsWithSubtitles: v.srtKeys?.length ?? 0,
    lessonsWithVideo: v.videoKeys?.length ?? 0,
    updatedAt: v.updatedAt ?? new Date(),
  }));

  return NextResponse.json({ dubbedVersions }, { status: 200 });
}
