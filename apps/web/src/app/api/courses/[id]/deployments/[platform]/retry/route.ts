import { NextResponse } from 'next/server';
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
 * POST /api/courses/[id]/deployments/[platform]/retry — relance le déploiement
 * d'une plateforme. Le worker REPREND depuis le checkpoint (leçons déjà
 * uploadées ignorées) : on ne réinitialise pas le point de reprise, on remet
 * seulement le statut à 'pending' et on ré-enfile le job.
 */

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; platform: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id, platform } = await params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: 'Cours introuvable.' }, { status: 404 });
  }
  if (!isKnownPlatform(platform)) {
    return NextResponse.json({ error: 'Plateforme inconnue.' }, { status: 400 });
  }

  await connectDb();

  const course = await CourseModel.findOne({ _id: id, userId: user.id })
    .select('_id')
    .lean();
  if (!course) {
    return NextResponse.json({ error: 'Cours introuvable.' }, { status: 404 });
  }

  const deployment = await Deployment.findOne({ courseId: id, platform });
  if (!deployment) {
    return NextResponse.json({ error: 'Déploiement introuvable.' }, { status: 404 });
  }

  // Statut 'pending' (reprise depuis checkpoint préservé) + trace.
  deployment.status = 'pending';
  deployment.logs.push({ ts: new Date(), level: 'info', msg: 'relance manuelle du déploiement' });
  await deployment.save();

  const caps = getCapabilities(platform);
  const mode = caps.modes.includes(deployment.mode as never)
    ? deployment.mode
    : (caps.modes[0] ?? 'auto');

  const queue = getDeploymentQueue();
  const jobId = makeJobId(id, QUEUES.deployment, platform);
  await queue.remove(jobId).catch(() => undefined);
  // Réutilise le compte plateforme d'origine (multi-comptes, P49) s'il est mémorisé.
  const credentialId = deployment.credentialId ? String(deployment.credentialId) : undefined;
  await queue.add(
    'deploy-course',
    {
      courseId: id,
      platform,
      userId: user.id,
      mode: mode as never,
      ...(credentialId ? { credentialId } : {}),
    },
    { ...defaultJobOptions, jobId },
  );

  return NextResponse.json({ courseId: id, platform, status: 'pending' }, { status: 202 });
}
