import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import {
  QUALITY_SCORE,
  QUEUES,
  checkApprovalGate,
  defaultJobOptions,
  makeJobId,
  resolveAgencyDeployCredentials,
} from '@sallycourse/shared';
import {
  AgencyClient,
  Course as CourseModel,
  Deployment,
  DEPLOYMENT_MODES,
  PlatformCredential,
  Workspace,
  connectDb,
  recordAudit,
} from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { getDeploymentQueue } from '@/lib/queues';
import { getCapabilities, isKnownPlatform } from '@/lib/deploy-catalog';
import { checkDeployPlatformLimit } from '@/lib/quota';
import { extractClientIp } from '@/lib/rate-limit';
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
  /**
   * Confirmation explicite (P94) : autorise le déploiement malgré un score de
   * qualité pédagogique sous le seuil. Défaut false — le blocage est visible,
   * jamais silencieux (l'utilisateur doit cocher une case dédiée côté UI).
   */
  confirmLowQuality: z.boolean().optional().default(false),
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
    .select('_id status aiDisclosureAccepted qualityScore workspaceId approvedBy agencyClientId')
    .lean();
  if (!course) {
    return NextResponse.json({ error: 'Cours introuvable.' }, { status: 404 });
  }

  // Mode agence (P150) : les credentials autorisés pour ce cours sont ceux du
  // CLIENT référencé, jamais ceux de l'agence — résolu une fois ici et
  // réutilisé pour valider chaque credentialId demandé plus bas.
  let agencyAllowedCredentialIds: string[] | null = null;
  if (course.agencyClientId) {
    const clientDoc = await AgencyClient.findById(course.agencyClientId).lean();
    const agencyCtx = resolveAgencyDeployCredentials(
      { userId: String(course.userId ?? user.id), agencyClientId: String(course.agencyClientId) },
      clientDoc
        ? {
            id: String(clientDoc._id),
            agencyUserId: String(clientDoc.agencyUserId),
            clientName: clientDoc.clientName,
            clientEmail: clientDoc.clientEmail,
            platformCredentials: clientDoc.platformCredentials.map(String),
          }
        : null,
    );
    if (agencyCtx.reason) {
      return NextResponse.json({ error: agencyCtx.reason, code: 'agency_context_invalid' }, { status: 403 });
    }
    agencyAllowedCredentialIds = agencyCtx.allowedCredentialIds;
  }

  // Gate d'approbation d'équipe (P138) : refus immédiat si le workspace du
  // cours a des reviewers et qu'aucune approbation n'a été enregistrée.
  if (course.workspaceId) {
    const workspace = await Workspace.findById(course.workspaceId).lean();
    const gate = checkApprovalGate(
      {
        workspaceId: String(course.workspaceId),
        approvedBy: course.approvedBy ? String(course.approvedBy) : null,
      },
      workspace
        ? {
            ownerId: String(workspace.ownerId),
            members: workspace.members.map((m) => ({ userId: String(m.userId), role: m.role })),
          }
        : null,
    );
    if (!gate.allowed) {
      return NextResponse.json(
        { error: gate.reason, code: 'approval_required' },
        { status: 403 },
      );
    }
  }

  // Le cours doit être abouti pour être déployé.
  if (course.status !== 'ready' && course.status !== 'published') {
    return NextResponse.json(
      { error: 'Le cours doit être généré (prêt) avant tout déploiement.' },
      { status: 409 },
    );
  }

  // Mention IA générée (P66, conformité Udemy) : la plateforme exige la
  // transparence sur le contenu généré par IA. Bloque le déploiement udemy
  // tant que l'auteur n'a pas coché la case dans le flow de publication.
  if (requested.includes('udemy') && !course.aiDisclosureAccepted) {
    return NextResponse.json(
      {
        error:
          "Vous devez confirmer la mention « contenu généré par IA » avant de publier sur Udemy.",
        code: 'ai_disclosure_required',
      },
      { status: 403 },
    );
  }

  // Score de qualité pédagogique (P94) : bloque avec message clair si sous le
  // seuil, mais reste contournable par l'utilisateur avec confirmation
  // explicite (confirmLowQuality) — jamais un blocage silencieux.
  const rawScore = (course.qualityScore as { score?: unknown } | null | undefined)?.score;
  const score = typeof rawScore === 'number' ? rawScore : null;
  if (score !== null && score < QUALITY_SCORE.MIN_DEPLOY_THRESHOLD && !parsed.data.confirmLowQuality) {
    return NextResponse.json(
      {
        error:
          `Score de qualité pédagogique ${score}/100, sous le seuil recommandé de ` +
          `${QUALITY_SCORE.MIN_DEPLOY_THRESHOLD}/100. Améliorez le cours avant publication, ` +
          `ou confirmez explicitement pour publier malgré tout.`,
        code: 'quality_score_below_threshold',
        score,
        threshold: QUALITY_SCORE.MIN_DEPLOY_THRESHOLD,
      },
      { status: 403 },
    );
  }

  // Multi-comptes (P49) : valide que chaque compte demandé appartient à
  // l'utilisateur ET à la bonne plateforme. Un id invalide/étranger est rejeté
  // (on ne déploie jamais avec le mauvais compte). Mode agence (P150) : le
  // compte doit appartenir à la liste autorisée du CLIENT, pas à l'agence.
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
    if (agencyAllowedCredentialIds !== null) {
      if (!agencyAllowedCredentialIds.includes(credentialId)) {
        return NextResponse.json(
          { error: `Compte introuvable pour ${platform} (hors périmètre du client).` },
          { status: 404 },
        );
      }
    } else {
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

  // Journal d'audit (P149) : un déploiement lancé = une entrée (toutes
  // plateformes enfilées dans ce lot, best-effort).
  void recordAudit({
    action: 'deployment.created',
    userId: user.id,
    targetType: 'course',
    targetId: id,
    ip: extractClientIp(request),
    userAgent: request.headers.get('user-agent') ?? undefined,
    metadata: { platforms: requested, mode: parsed.data.mode },
  });

  return NextResponse.json({ courseId: id, deployments: enqueued }, { status: 202 });
}
