import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import { QUEUES, defaultJobOptions, makeJobId } from '@sallycourse/shared';
import { connectDb, Course as CourseModel, Deployment } from '@sallycourse/db';
import { requireApiKeyUser } from '@/lib/api-auth';
import { getDeploymentQueue } from '@/lib/queues';
import { getCapabilities, isKnownPlatform } from '@/lib/deploy-catalog';
import { v1DeploySchema } from '@/lib/v1-schemas';

/**
 * POST /api/v1/courses/[id]/deploy — déploiement multi-plateformes via l'API
 * publique (clé API). Même logique que la route UI : pré-crée un Deployment
 * 'pending' par plateforme et enfile un job 'deployment' à jobId déterministe.
 */

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiKeyUser(request);
  if (auth instanceof Response) return auth;

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

  const parsed = v1DeploySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Données invalides.', code: 'invalidData', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const requested = [...new Set(parsed.data.platforms)];
  const unknown = requested.filter((p) => !isKnownPlatform(p));
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: `Plateforme(s) inconnue(s) : ${unknown.join(', ')}.`, code: 'v1DeployUnknownPlatforms', params: { platforms: unknown.join(', ') } },
      { status: 400 },
    );
  }

  await connectDb();

  const course = await CourseModel.findOne({ _id: id, userId: auth.userId })
    .select('_id status')
    .lean();
  if (!course) {
    return apiError('courseNotFound');
  }

  if (course.status !== 'ready' && course.status !== 'published') {
    return NextResponse.json(
      { error: 'Le cours doit être généré (prêt) avant tout déploiement.', code: 'courseNotReadyForDeploy' },
      { status: 409 },
    );
  }

  const queue = getDeploymentQueue();
  const enqueued: { platform: string; mode: string }[] = [];

  for (const platform of requested) {
    const caps = getCapabilities(platform);
    const mode = caps.modes.includes(parsed.data.mode as never)
      ? parsed.data.mode
      : (caps.modes[0] ?? 'auto');

    await Deployment.findOneAndUpdate(
      { courseId: id, platform },
      {
        $set: { status: 'pending', mode },
        $setOnInsert: {
          courseId: id,
          userId: auth.userId,
          platform,
          checkpoint: { lessonIndex: 0, step: '' },
          logs: [],
        },
      },
      { upsert: true, new: true },
    );

    const jobId = makeJobId(id, QUEUES.deployment, platform);
    await queue.remove(jobId).catch(() => undefined);
    await queue.add(
      'deploy-course',
      { courseId: id, platform, userId: auth.userId, mode: mode as never },
      { ...defaultJobOptions, jobId },
    );
    enqueued.push({ platform, mode });
  }

  return NextResponse.json({ courseId: id, deployments: enqueued }, { status: 202 });
}
