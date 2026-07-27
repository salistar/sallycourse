import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import { QUEUES, defaultJobOptions, makeJobId } from '@sallycourse/shared';
import {
  Course as CourseModel,
  Deployment,
  DeployPreset,
  PlatformCredential,
  connectDb,
} from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { getDeploymentQueue } from '@/lib/queues';
import { buildPresetDeployJobs } from '@/lib/deploy-presets';

/**
 * POST /api/courses/[id]/apply-preset/[presetId] — applique un preset de
 * déploiement (P109) à un cours : enfile en un clic les jobs de déploiement
 * pour chaque plateforme du preset, avec le mode et le compte (résolu par
 * accountLabel sur les credentials de l'utilisateur COURANT — jamais ceux du
 * créateur du preset, même pour un preset public). Un preset applicable est
 * soit le sien, soit public.
 */

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; presetId: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id, presetId } = await params;
  if (!isValidObjectId(id) || !isValidObjectId(presetId)) {
    return NextResponse.json({ error: 'Identifiant invalide.', code: 'invalidId' }, { status: 404 });
  }

  await connectDb();

  const course = await CourseModel.findOne({ _id: id, userId: user.id })
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

  // Preset accessible : le sien, ou public (partagé par un autre utilisateur).
  const preset = await DeployPreset.findOne({
    _id: presetId,
    $or: [{ userId: user.id }, { isPublic: true }],
  }).lean();
  if (!preset) {
    return apiError('presetNotFound');
  }

  // Comptes connectés de l'utilisateur COURANT (résolution accountLabel → id).
  const myCredentials = await PlatformCredential.find({ userId: user.id })
    .select('platform accountLabel')
    .lean();

  const { jobs, skipped } = buildPresetDeployJobs(
    preset.platforms.map((p) => ({
      platform: p.platform,
      mode: p.mode,
      accountLabel: p.accountLabel,
    })),
    myCredentials.map((c) => ({
      id: String(c._id),
      platform: c.platform,
      accountLabel: c.accountLabel,
    })),
  );

  if (jobs.length === 0) {
    return NextResponse.json(
      { error: 'Aucune plateforme applicable dans ce preset.', code: 'noApplicablePlatformInPreset', skipped },
      { status: 400 },
    );
  }

  const queue = getDeploymentQueue();
  const enqueued: { platform: string; mode: string }[] = [];

  for (const job of jobs) {
    await Deployment.findOneAndUpdate(
      { courseId: id, platform: job.platform },
      {
        $set: {
          status: 'pending',
          mode: job.mode,
          ...(job.credentialId ? { credentialId: job.credentialId } : {}),
        },
        $setOnInsert: {
          courseId: id,
          userId: user.id,
          platform: job.platform,
          checkpoint: { lessonIndex: 0, step: '' },
          logs: [],
        },
      },
      { upsert: true, new: true },
    );

    const jobId = makeJobId(id, QUEUES.deployment, job.platform);
    await queue.remove(jobId).catch(() => undefined);
    await queue.add(
      'deploy-course',
      {
        courseId: id,
        platform: job.platform,
        userId: user.id,
        mode: job.mode as never,
        ...(job.credentialId ? { credentialId: job.credentialId } : {}),
      },
      { ...defaultJobOptions, jobId },
    );
    enqueued.push({ platform: job.platform, mode: job.mode });
  }

  return NextResponse.json(
    { courseId: id, presetId, deployments: enqueued, skipped },
    { status: 202 },
  );
}
