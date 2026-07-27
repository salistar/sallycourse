import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import {
  canPublishManually,
  initManualChecklist,
  isValidHttpUrl,
  mergeChecklistDone,
  type DeployChecklistDoneInput,
  type DeployChecklistItem,
} from '@sallycourse/shared';
import {
  Course as CourseModel,
  Deployment,
  connectDb,
} from '@sallycourse/db';
import { z } from 'zod';
import { requireApiUser } from '@/lib/session';
import { isKnownPlatform } from '@/lib/deploy-catalog';
import { extractClientIp, rateLimit } from '@/lib/rate-limit';

/**
 * PATCH /api/courses/[id]/deployments/[platform]/status (P178) — met à jour le
 * suivi de la publication MANUELLE d'un déploiement : l'auteur coche les étapes
 * de la checklist et colle l'URL publique finale. Dès que toutes les cases sont
 * cochées ET que l'URL est http(s) valide, le déploiement bascule en `published`
 * (+ publishedManuallyAt + externalUrl) — ce qui embraye les mêmes traitements
 * que les autres modes (rapport P50, polling review P47).
 *
 * Sécurité : ownership → 404 (convention repo). Les libellés/keys de la checklist
 * viennent TOUJOURS du serveur ; on ne reprend du client que l'état `done` par
 * clé (cf. mergeChecklistDone). Rate-limit léger.
 */

export const dynamic = 'force-dynamic';

/** Action légère mais protégée contre le matraquage. */
const STATUS_USER_LIMIT = { limit: 60, windowSec: 60 };
const STATUS_IP_LIMIT = { limit: 120, windowSec: 60 };

const bodySchema = z.object({
  externalUrl: z.string().trim().max(2048).optional(),
  checklist: z
    .array(z.object({ key: z.string().min(1).max(64), done: z.boolean().optional() }))
    .max(50)
    .optional(),
});

export async function PATCH(
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
    return NextResponse.json(
      { error: 'Données invalides.', code: 'invalidData', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const ip = extractClientIp(request);
  const [userLimit, ipLimit] = await Promise.all([
    rateLimit(`deploy-status:user:${user.id}`, STATUS_USER_LIMIT),
    rateLimit(`deploy-status:ip:${ip}`, STATUS_IP_LIMIT),
  ]);
  const hit = !userLimit.allowed ? userLimit : !ipLimit.allowed ? ipLimit : null;
  if (hit) {
    return NextResponse.json(
      { error: 'Trop de mises à jour, réessayez dans un instant.', code: 'rate_limited' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((hit.resetAt.getTime() - Date.now()) / 1000)) },
      },
    );
  }

  // URL fournie : si non vide, elle doit être une http(s) valide (jamais stockée
  // sinon — elle sert de lien public et de déclencheur de publication).
  const rawUrl = parsed.data.externalUrl?.trim();
  if (rawUrl && !isValidHttpUrl(rawUrl)) {
    return NextResponse.json(
      { error: 'URL de publication invalide : fournissez une adresse http(s) complète.', code: 'invalidPublicationUrl' },
      { status: 400 },
    );
  }

  await connectDb();

  // Ownership : 404 (et non 403) — convention du repo, ne révèle pas l'existence.
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

  // Cette route de publication par checklist est RÉSERVÉE au mode manuel. Sans ce
  // garde, on pourrait forcer status='published' sur un déploiement auto/assisté
  // en court-circuitant ses portes (approbation P138, seuil qualité, mention IA).
  if (deployment.mode !== 'manual') {
    return NextResponse.json(
      { error: 'Ce déploiement n’est pas en mode manuel.', code: 'deploymentNotManualMode' },
      { status: 409 },
    );
  }

  // Base de checklist : celle du déploiement, ou l'initiale de la plateforme si
  // absente (ex. déploiement pré-P178 ou créé dans un autre mode). On n'applique
  // du client que l'état `done` par clé (les libellés restent serveur).
  const base: DeployChecklistItem[] =
    deployment.checklist && deployment.checklist.length > 0
      ? deployment.checklist.map((i) => ({ key: i.key, label: i.label, done: i.done }))
      : initManualChecklist(platform);
  const merged = mergeChecklistDone(base, parsed.data.checklist as DeployChecklistDoneInput[] | undefined);
  deployment.checklist = merged;

  if (rawUrl) deployment.externalUrl = rawUrl;

  // Bascule en publié dès que tout est coché ET l'URL valide. Idempotent : si
  // c'est déjà publié, on n'écrase pas publishedManuallyAt.
  let published = deployment.status === 'published';
  if (canPublishManually(merged, deployment.externalUrl)) {
    if (deployment.status !== 'published') {
      deployment.status = 'published';
      deployment.publishedManuallyAt = new Date();
      deployment.checkpoint = { lessonIndex: deployment.checkpoint?.lessonIndex ?? 0, step: 'done' };
      deployment.logs.push({
        ts: new Date(),
        level: 'info',
        msg: `publication manuelle confirmée : ${deployment.externalUrl}`,
      });
    }
    published = true;
  }

  await deployment.save();

  return NextResponse.json(
    {
      courseId: id,
      platform,
      status: deployment.status,
      externalUrl: deployment.externalUrl ?? null,
      checklist: deployment.checklist,
      publishedManuallyAt: deployment.publishedManuallyAt
        ? deployment.publishedManuallyAt.getTime()
        : null,
      published,
    },
    { status: 200 },
  );
}
