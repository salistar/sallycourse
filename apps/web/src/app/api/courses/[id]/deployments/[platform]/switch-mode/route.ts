import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { QUEUES, defaultJobOptions, makeJobId } from '@sallycourse/shared';
import { Course as CourseModel, Deployment, connectDb } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { getDeploymentQueue, getPackagingQueue } from '@/lib/queues';
import { getCapabilities, isKnownPlatform } from '@/lib/deploy-catalog';
import { extractClientIp, rateLimit } from '@/lib/rate-limit';

/**
 * POST /api/courses/[id]/deployments/[platform]/switch-mode (Prompt 179) —
 * BASCULE un déploiement bloqué (captcha, sélecteur cassé) vers un autre mode, en
 * REPRENANT depuis le checkpoint préservé (jamais de reprise à zéro) :
 *
 *  - `assisted` : ré-enfile le job deploy en mode assisté (l'humain prend la main
 *    sur les étapes non automatisables) — clone du patron retry/route.ts, le
 *    worker repart du checkpoint (leçons déjà uploadées ignorées).
 *  - `manual`   : bascule le Deployment en mode manuel et enfile un pack GUIDE de
 *    reprise (P176 réutilisé, paramétré avec le checkpoint) qui ne contient que
 *    les étapes RESTANTES, l'état déjà-fait indiqué. L'auteur termine à la main et
 *    rend compte via le panneau de publication manuelle (P178).
 *
 * Sécurité : ownership → 404 (convention repo). Bascule réservée aux déploiements
 * réellement bloqués (status paused/failed). Le mode cible doit être supporté par
 * la plateforme. Rate-limit léger (action qui enfile un job).
 */

export const dynamic = 'force-dynamic';

const SWITCH_USER_LIMIT = { limit: 30, windowSec: 60 };
const SWITCH_IP_LIMIT = { limit: 60, windowSec: 60 };

const bodySchema = z.object({
  mode: z.enum(['assisted', 'manual']),
});

export async function POST(
  request: Request,
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

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError('invalidJson');
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Mode cible invalide (assisted ou manual).', code: 'invalidTargetMode' }, { status: 400 });
  }
  const targetMode = parsed.data.mode;

  // Le mode cible doit être réellement supporté par la plateforme.
  if (!getCapabilities(platform).modes.includes(targetMode)) {
    return NextResponse.json(
      { error: `Le mode « ${targetMode} » n’est pas disponible pour cette plateforme.`, code: 'switchModeTargetModeUnavailable', params: { mode: targetMode } },
      { status: 400 },
    );
  }

  const ip = extractClientIp(request);
  const [userLimit, ipLimit] = await Promise.all([
    rateLimit(`deploy-switch:user:${user.id}`, SWITCH_USER_LIMIT),
    rateLimit(`deploy-switch:ip:${ip}`, SWITCH_IP_LIMIT),
  ]);
  const hit = !userLimit.allowed ? userLimit : !ipLimit.allowed ? ipLimit : null;
  if (hit) {
    return NextResponse.json(
      { error: 'Trop de bascules, réessayez dans un instant.', code: 'rate_limited' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((hit.resetAt.getTime() - Date.now()) / 1000)) },
      },
    );
  }

  await connectDb();

  // Ownership : 404 (et non 403) — convention du repo.
  const course = await CourseModel.findOne({ _id: id, userId: user.id }).select('_id').lean();
  if (!course) {
    return apiError('courseNotFound');
  }

  const deployment = await Deployment.findOne({ courseId: id, platform });
  if (!deployment) {
    return apiError('deploymentNotFound');
  }

  // Bascule réservée aux déploiements bloqués : un déploiement en cours ou déjà
  // publié ne se re-route pas (évite de doubler un job actif ou de rouvrir un publié).
  if (deployment.status !== 'paused' && deployment.status !== 'failed') {
    return NextResponse.json(
      { error: 'Seul un déploiement en pause ou en échec peut être basculé.', code: 'onlyPausedOrFailedDeploymentSwitchable' },
      { status: 409 },
    );
  }

  // Checkpoint PRÉSERVÉ : c'est le point de reprise commun aux deux modes.
  const checkpoint = {
    lessonIndex: deployment.checkpoint?.lessonIndex ?? 0,
    step: deployment.checkpoint?.step ?? '',
  };

  if (targetMode === 'assisted') {
    deployment.mode = 'assisted';
    deployment.status = 'pending';
    deployment.logs.push({
      ts: new Date(),
      level: 'info',
      msg: `bascule en mode assisté — reprise depuis « ${checkpoint.step || 'initialisation'} » (leçon ${checkpoint.lessonIndex})`,
    });
    await deployment.save();

    const queue = getDeploymentQueue();
    const jobId = makeJobId(id, QUEUES.deployment, platform);
    await queue.remove(jobId).catch(() => undefined);
    const credentialId = deployment.credentialId ? String(deployment.credentialId) : undefined;
    await queue.add(
      'deploy-course',
      {
        courseId: id,
        platform,
        userId: user.id,
        mode: 'assisted' as never,
        ...(credentialId ? { credentialId } : {}),
      },
      { ...defaultJobOptions, jobId },
    );

    return NextResponse.json({ courseId: id, platform, mode: 'assisted', status: 'pending', checkpoint }, { status: 202 });
  }

  // targetMode === 'manual' : bascule le mode + enfile le GUIDE de reprise (P176
  // réutilisé) paramétré par le checkpoint (étapes restantes uniquement).
  deployment.mode = 'manual';
  deployment.status = 'paused';
  deployment.logs.push({
    ts: new Date(),
    level: 'info',
    msg: `bascule en mode manuel — pack guide des étapes restantes depuis « ${checkpoint.step || 'initialisation'} » (leçon ${checkpoint.lessonIndex})`,
  });
  await deployment.save();

  try {
    const queue = getPackagingQueue();
    // jobId distinct du guide complet (P176) : le guide de reprise coexiste.
    const jobId = makeJobId(id, QUEUES.packaging, 'manual-guide-resume', platform);
    await queue.remove(jobId).catch(() => undefined);
    await queue.add(
      'course-manual-guide-resume',
      { courseId: id, mode: 'manual-guide', platform, resume: checkpoint },
      { ...defaultJobOptions, jobId },
    );
  } catch {
    // Le pack est best-effort : la bascule de mode a réussi (le panneau manuel
    // s'affiche), le guide partiel sera régénérable depuis le bouton dédié.
    return NextResponse.json(
      { courseId: id, platform, mode: 'manual', status: 'paused', checkpoint, guide: 'error' },
      { status: 202 },
    );
  }

  return NextResponse.json({ courseId: id, platform, mode: 'manual', status: 'paused', checkpoint, guide: 'queued' }, { status: 202 });
}
