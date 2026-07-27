import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import { QUEUES, defaultJobOptions, makeJobId } from '@sallycourse/shared';
import {
  Course as CourseModel,
  Deployment,
  connectDb,
} from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { getDeploymentQueue } from '@/lib/queues';
import { getCapabilities, isKnownPlatform } from '@/lib/deploy-catalog';

/**
 * POST /api/courses/[id]/deployments/[platform]/update (P46) — met à jour la
 * plateforme déjà déployée : le worker re-uploade UNIQUEMENT les leçons dont le
 * contenu a changé depuis le dernier déploiement (action 'update'). Nécessite un
 * déploiement existant avec un instantané (deployedVersions) ; sinon 409 (rien à
 * mettre à jour, il faut d'abord déployer). Job 'deployment' avec action:'update',
 * checkpoint remis à zéro pour repartir sur la liste des updates.
 */

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; platform: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id, platform } = await params;
  if (!isValidObjectId(id)) {
    return apiError('courseNotFound');
  }
  if (!isKnownPlatform(platform)) {
    return apiError('unknownPlatform');
  }

  await connectDb();

  const course = await CourseModel.findOne({ _id: id, userId: user.id })
    .select('_id')
    .lean();
  if (!course) {
    return apiError('courseNotFound');
  }

  const deployment = await Deployment.findOne({ courseId: id, platform });
  if (!deployment) {
    return apiError('deploymentNotFound');
  }

  // Une mise à jour n'a de sens que si le cours a déjà été déployé une fois.
  const deployedCount = deployment.deployedVersions?.length ?? 0;
  if (deployedCount === 0) {
    return NextResponse.json(
      { error: 'Aucun déploiement de référence : déployez d’abord le cours sur cette plateforme.', code: 'noReferenceDeployment' },
      { status: 409 },
    );
  }

  // Reprise sur la liste des updates : on repart du début (curseur 0).
  deployment.status = 'pending';
  deployment.checkpoint = { lessonIndex: 0, step: '' };
  deployment.logs.push({ ts: new Date(), level: 'info', msg: 'mise à jour ciblée demandée' });
  await deployment.save();

  const caps = getCapabilities(platform);
  const mode = caps.modes.includes(deployment.mode as never)
    ? deployment.mode
    : (caps.modes[0] ?? 'auto');

  const queue = getDeploymentQueue();
  // jobId distinct de 'deploy' pour ne pas se marcher dessus avec un déploiement.
  const jobId = makeJobId(id, QUEUES.deployment, platform, 'update');
  await queue.remove(jobId).catch(() => undefined);
  await queue.add(
    'update-course',
    { courseId: id, platform, userId: user.id, mode: mode as never, action: 'update' },
    { ...defaultJobOptions, jobId },
  );

  return NextResponse.json({ courseId: id, platform, status: 'pending', action: 'update' }, { status: 202 });
}
