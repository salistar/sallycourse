import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { QUEUES, defaultJobOptions, makeJobId } from '@sallycourse/shared';
import {
  Course as CourseModel,
  Deployment,
  DEPLOYMENT_MODES,
  PlatformCredential,
  connectDb,
} from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { getDeploymentQueue } from '@/lib/queues';
import { getCapabilities, isKnownPlatform } from '@/lib/deploy-catalog';
import { checkDeployPlatformLimit } from '@/lib/quota';
import type { PlanId } from '@sallycourse/shared';

/**
 * POST /api/courses/[id]/deploy — lance un déploiement multi-plateformes.
 * Corps : { platforms: string[], mode }. Enfile un job 'deployment' par
 * plateforme (jobId déterministe : re-poster ne duplique pas). La concurrence
 * réelle (max 2 simultanés) est appliquée par le worker ; ici on enfile tout,
 * BullMQ ordonnance. Un Deployment 'pending' est pré-créé pour un retour
 * immédiat dans le tableau de bord.
 */

const deploySchema = z.object({
  platforms: z.array(z.string()).min(1).max(9),
  mode: z.enum(DEPLOYMENT_MODES as unknown as [string, ...string[]]).default('auto'),
  /**
   * Compte à utiliser par plateforme (multi-comptes, P49) : { [platform]: credentialId }.
   * Optionnel — plateforme absente → le worker retient le compte le plus récent.
   */
  credentials: z.record(z.string(), z.string()).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: 'Cours introuvable.' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 });
  }

  const parsed = deploySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Données invalides.', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  // Dédoublonnage + rejet des plateformes inconnues.
  const requested = [...new Set(parsed.data.platforms)];
  const unknown = requested.filter((p) => !isKnownPlatform(p));
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: `Plateforme(s) inconnue(s) : ${unknown.join(', ')}.` },
      { status: 400 },
    );
  }

  // Quota de déploiement selon le plan (P53) : free est bridé à 1 plateforme par
  // lot ; pro/business déploient partout. On refuse avant d'enfiler quoi que ce soit.
  const plan = (user.plan ?? 'free') as PlanId;
  const gate = checkDeployPlatformLimit(plan, requested.length);
  if (!gate.ok) {
    return NextResponse.json(
      {
        error:
          gate.limit === 1
            ? `Le plan ${gate.plan} ne déploie qu'une plateforme à la fois. Passez à un plan supérieur pour déployer partout.`
            : `Le plan ${gate.plan} limite le déploiement à ${gate.limit} plateforme(s) par lot.`,
        code: 'deploy_plan_limit',
      },
      { status: 403 },
    );
  }

  await connectDb();

  const course = await CourseModel.findOne({ _id: id, userId: user.id })
    .select('_id status')
    .lean();
  if (!course) {
    return NextResponse.json({ error: 'Cours introuvable.' }, { status: 404 });
  }

  // Le cours doit être abouti pour être déployé.
  if (course.status !== 'ready' && course.status !== 'published') {
    return NextResponse.json(
      { error: 'Le cours doit être généré (prêt) avant tout déploiement.' },
      { status: 409 },
    );
  }

  // Multi-comptes (P49) : valide que chaque compte demandé appartient à
  // l'utilisateur ET à la bonne plateforme. Un id invalide/étranger est rejeté
  // (on ne déploie jamais avec le mauvais compte).
  const selected = parsed.data.credentials ?? {};
  const selectedByPlatform: Record<string, string> = {};
  for (const platform of requested) {
    const credentialId = selected[platform];
    if (!credentialId) continue;
    if (!isValidObjectId(credentialId)) {
      return NextResponse.json(
        { error: `Compte invalide pour ${platform}.` },
        { status: 400 },
      );
    }
    const cred = await PlatformCredential.findOne({
      _id: credentialId,
      userId: user.id,
      platform,
    })
      .select('_id')
      .lean();
    if (!cred) {
      return NextResponse.json(
        { error: `Compte introuvable pour ${platform}.` },
        { status: 404 },
      );
    }
    selectedByPlatform[platform] = credentialId;
  }

  const queue = getDeploymentQueue();
  const enqueued: { platform: string; mode: string }[] = [];

  for (const platform of requested) {
    // Mode effectif : rabattu sur un mode supporté par l'adapter.
    const caps = getCapabilities(platform);
    const mode = caps.modes.includes(parsed.data.mode as never)
      ? parsed.data.mode
      : (caps.modes[0] ?? 'auto');

    // Pré-création/mise à jour du Deployment (affichage immédiat côté client).
    // On mémorise le compte retenu (P49) pour que les relances le réutilisent.
    const chosenCredentialId = selectedByPlatform[platform];
    await Deployment.findOneAndUpdate(
      { courseId: id, platform },
      {
        $set: {
          status: 'pending',
          mode,
          ...(chosenCredentialId ? { credentialId: chosenCredentialId } : {}),
        },
        $setOnInsert: {
          courseId: id,
          userId: user.id,
          platform,
          checkpoint: { lessonIndex: 0, step: '' },
          logs: [],
        },
      },
      { upsert: true, new: true },
    );

    // jobId déterministe par (course, deployment, platform) : pas de doublon.
    const jobId = makeJobId(id, QUEUES.deployment, platform);
    await queue.remove(jobId).catch(() => undefined);
    await queue.add(
      'deploy-course',
      {
        courseId: id,
        platform,
        userId: user.id,
        mode: mode as never,
        // Compte plateforme retenu (P49) ; absent → worker choisit le plus récent.
        ...(selectedByPlatform[platform]
          ? { credentialId: selectedByPlatform[platform] }
          : {}),
      },
      { ...defaultJobOptions, jobId },
    );
    enqueued.push({ platform, mode });
  }

  return NextResponse.json({ courseId: id, deployments: enqueued }, { status: 202 });
}
