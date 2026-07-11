// Processor BullMQ « deployment » (Prompt 31) : publie un cours sur une
// plateforme cible (Udemy, YouTube…) via un adapter du registre. Pilote le flow
// générique authenticate → createCourse → uploadLesson* (checkpoint par leçon
// pour REPRISE) → setLandingPage → submitForReview → getStatus, en persistant
// à chaque étape l'état du Deployment (status/externalUrl/checkpoint/logs).
//
// Reprise : si un Deployment existe déjà pour (course, platform), on repart de
// son checkpoint (leçons < lessonIndex déjà uploadées → ignorées). L'échec
// bascule le statut en 'failed' avec une erreur structurée, sans perdre le
// checkpoint (une relance du job reprend là où on s'était arrêté).

import type { Job } from 'bullmq';
import {
  Course,
  Deployment,
  Lesson,
  PlatformCredential,
  Section,
  QUEUES,
  decryptCredentials,
  getConfig,
  notify,
  publishProgress,
  type DeploymentDocument,
  type DeploymentJobData,
  type DeploymentMode,
  type ICourse,
  type ILesson,
  type ISection,
} from '../shared.js';
import { getRedisConnection } from '../queues/connection.js';
import { logger } from '../queues/index.js';
import { getAdapter } from '../deploy/registry.js';
import { runResumableUploads } from '../deploy/resume.js';
import { selectCredential, type CredentialCandidate } from '../deploy/credential-select.js';
import { runDeploymentUpdate, writeDeployedSnapshot } from '../deploy/update-runner.js';
import { generateDeploymentReport, type DeploymentLike } from '../deploy/report.js';
import { translatePublishedCourse } from '../lib/translate-published.js';
import { detectLessonUpdates, nextSnapshot } from '../deploy/updates.js';
import type {
  BoundPublishProgress,
  DeployContext,
  DeployCredentials,
  DeployResult,
} from '../deploy/types.js';

/** Plateforme par défaut si le job n'en précise pas. */
const DEFAULT_PLATFORM = 'udemy';

/** publishProgress borné au cours + step 'deployment' (best-effort). */
function boundProgress(courseId: string): BoundPublishProgress {
  return async (progress, message, level = 'info') => {
    try {
      await publishProgress(getRedisConnection(), {
        courseId,
        step: QUEUES.deployment,
        progress,
        message,
        level,
        ts: Date.now(),
      });
    } catch (err) {
      logger.warn({ courseId, err }, 'progression déploiement non publiée');
    }
  };
}

/** Compte plateforme résolu : id (pour l'isolation de session) + secrets déchiffrés. */
interface ResolvedCredential {
  credentialId?: string;
  credentials: DeployCredentials;
}

/**
 * Résout le compte plateforme à utiliser (multi-comptes, P49) puis déchiffre ses
 * secrets. Sélection : le PlatformCredential désigné par `credentialId`, sinon le
 * plus récemment mis à jour pour (userId, platform). En MOCK_PROVIDERS, aucun
 * compte demandé, aucun compte connecté, ou déchiffrement impossible → objet vide
 * (l'adapter bascule alors en mode simulé). Le credentialId retenu est renvoyé
 * pour isoler la session Playwright par compte.
 */
async function loadCredentials(
  userId: unknown,
  platform: string,
  credentialId: string | undefined,
  mock: boolean,
): Promise<ResolvedCredential> {
  if (mock) return { credentials: {} };
  const config = getConfig();

  // Comptes connectés de l'utilisateur pour cette plateforme (récents d'abord).
  const docs = await PlatformCredential.find({ userId, platform })
    .sort({ updatedAt: -1 })
    .lean();
  const candidates: Array<CredentialCandidate & { data: string }> = docs.map((d) => ({
    id: String(d._id),
    platform: d.platform,
    accountLabel: d.accountLabel,
    data: d.data,
  }));

  const chosen = selectCredential(candidates, credentialId);
  if (!chosen) {
    if (credentialId) {
      logger.warn({ platform, credentialId }, 'compte plateforme demandé introuvable — mode simulé');
    }
    return { credentials: {} };
  }

  try {
    const credentials = decryptCredentials(chosen.data, config.CREDENTIALS_MASTER_KEY);
    return { credentialId: chosen.id, credentials };
  } catch (err) {
    logger.warn({ platform, credentialId: chosen.id, err }, 'déchiffrement des credentials impossible — mode simulé');
    return { credentials: {} };
  }
}

/** Retrouve ou crée le Deployment pour (course, platform, user, mode). */
async function loadOrCreateDeployment(
  courseId: string,
  userId: unknown,
  platform: string,
  mode: DeploymentMode,
): Promise<DeploymentDocument> {
  const existing = await Deployment.findOne({ courseId, platform });
  if (existing) {
    // Reprise : on ne réinitialise PAS le checkpoint (point de reprise).
    if (existing.status === 'failed' || existing.status === 'paused') {
      existing.status = 'running';
    }
    if (mode) existing.mode = mode;
    await existing.save();
    return existing;
  }
  return Deployment.create({
    courseId,
    userId,
    platform,
    mode,
    status: 'running',
    checkpoint: { lessonIndex: 0, step: '' },
    logs: [],
  });
}

/**
 * Processor de la queue deployment (un job = un cours sur une plateforme).
 */
export async function processDeployment(
  job: Job<DeploymentJobData>,
): Promise<DeployResult> {
  const { courseId } = job.data;
  const platform = job.data.platform ?? DEFAULT_PLATFORM;
  const mode: DeploymentMode = job.data.mode ?? 'auto';
  const report = boundProgress(courseId);

  const config = getConfig();
  const mock = config.MOCK_PROVIDERS;

  const course = (await Course.findById(courseId)) as
    | (ICourse & { _id: unknown })
    | null;
  if (!course) throw new Error(`cours introuvable : ${courseId}`);

  const userId = job.data.userId ?? course.userId;

  // ── Action « report » (P50) : rapport PDF de synthèse, toutes plateformes ──
  // Indépendant des adapters : agrège les Deployment du cours et archive le PDF.
  if (job.data.action === 'report') {
    try {
      await report(5, 'Génération du rapport de déploiement');
      const deployments = await Deployment.find({ courseId })
        .sort({ updatedAt: -1 })
        .lean<DeploymentLike[]>();
      const result = await generateDeploymentReport(course, deployments, mock);
      await report(100, `Rapport prêt : ${result.platforms} plateforme(s)`);
      logger.info({ courseId, reportKey: result.reportKey }, 'rapport de déploiement archivé');
      return {
        platform: 'report',
        status: 'published',
        lessonsUploaded: 0,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ courseId, err }, 'échec de la génération du rapport de déploiement');
      await report(0, `Échec du rapport : ${message}`, 'error').catch(() => undefined);
      throw err;
    }
  }

  // ── Action « translate » (P92) : traduction des sous-titres d'un cours déjà
  // déployé + upload des captions sur chaque plateforme déployée, doublage
  // optionnel (nouveau TTS + MP4). Indépendant d'un adapter précis (agit sur
  // TOUS les déploiements du cours, ou seulement `platform` si fourni).
  if (job.data.action === 'translate') {
    try {
      await report(5, 'Traduction des sous-titres en cours');
      const result = await translatePublishedCourse(courseId, job.data.targetLocales ?? [], {
        dub: job.data.dub,
        platforms: job.data.platform ? [job.data.platform] : undefined,
      });
      await report(
        100,
        `Traduction terminée : ${result.lessonsTranslated} leçon(s) × ${result.locales.length} langue(s)` +
          (result.errors.length > 0 ? ` (${result.errors.length} erreur(s))` : ''),
      );
      logger.info({ courseId, result }, 'traduction du cours publié terminée');
      return {
        platform: 'translate',
        status: 'published',
        lessonsUploaded: result.lessonsTranslated,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ courseId, err }, 'échec de la traduction du cours publié');
      await report(0, `Échec de la traduction : ${message}`, 'error').catch(() => undefined);
      throw err;
    }
  }

  const adapter = getAdapter(platform);

  // Mode non supporté par l'adapter → on retombe sur son premier mode déclaré.
  const effectiveMode: DeploymentMode = adapter.capabilities.modes.includes(mode)
    ? mode
    : (adapter.capabilities.modes[0] ?? 'auto');

  const deployment = await loadOrCreateDeployment(courseId, userId, platform, effectiveMode);

  const [sections, lessons, resolved] = await Promise.all([
    Section.find({ courseId: course._id }).sort({ order: 1 }).lean<ISection[]>(),
    Lesson.find({ courseId: course._id }).sort({ order: 1 }).lean<ILesson[]>(),
    loadCredentials(userId, platform, job.data.credentialId, mock),
  ]);
  const { credentials, credentialId } = resolved;

  const ctx: DeployContext = {
    platform,
    mode: effectiveMode,
    course,
    sections,
    lessons,
    credentials,
    credentialId,
    checkpoint: {
      lessonIndex: deployment.checkpoint?.lessonIndex ?? 0,
      step: deployment.checkpoint?.step ?? '',
    },
    externalId: undefined,
    publishProgress: report,
    logger,
    mock,
    deployment,
  };

  // ── Action « update » (P46) : mise à jour ciblée des leçons modifiées ──
  // Ne s'applique qu'à un cours DÉJÀ déployé ; sinon on retombe sur un déploiement
  // complet (rien n'a encore été publié, tout est « nouveau »).
  const alreadyDeployed =
    Array.isArray((deployment as { deployedVersions?: unknown }).deployedVersions) &&
    (deployment as { deployedVersions: unknown[] }).deployedVersions.length > 0;
  if (job.data.action === 'update' && alreadyDeployed) {
    try {
      return await runDeploymentUpdate(adapter, ctx, report);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deployment.status = 'failed';
      deployment.logs.push({ ts: new Date(), level: 'error', msg: `échec de la mise à jour : ${message}` });
      await deployment.save().catch(() => undefined);
      logger.error({ courseId, platform, checkpoint: deployment.checkpoint, err }, 'échec de la mise à jour');
      await report(0, `Échec de la mise à jour : ${message}`, 'error').catch(() => undefined);
      throw err;
    }
  }

  let lessonsUploaded = 0;

  try {
    await report(2, `Déploiement ${platform} démarré (mode ${effectiveMode})`);

    // 1) Authentification.
    await adapter.authenticate(ctx);

    // 2) Création du cours (idempotent : réutilise externalId du checkpoint si repris).
    const { externalId } = await adapter.createCourse(ctx);
    ctx.externalId = externalId;
    await report(15, 'Cours créé côté plateforme');

    // 3) Upload des leçons, checkpoint par leçon (REPRISE depuis lessonIndex).
    lessonsUploaded = await runResumableUploads(
      lessons.length,
      ctx.checkpoint,
      async (index) => {
        await adapter.uploadLesson(ctx, lessons[index]!, index);
      },
      async (nextLessonIndex) => {
        // Avance le checkpoint APRÈS succès : une reprise repartira d'ici.
        ctx.checkpoint = { lessonIndex: nextLessonIndex, step: 'upload' };
        deployment.checkpoint = { lessonIndex: nextLessonIndex, step: 'upload' };
        if (!mock) await deployment.save();
        const pct = 15 + Math.round((nextLessonIndex / Math.max(1, lessons.length)) * 60);
        await report(pct, `Leçon ${nextLessonIndex}/${lessons.length} uploadée`);
      },
    );

    // 4) Landing / présentation du cours.
    await adapter.setLandingPage(ctx);
    ctx.checkpoint = { lessonIndex: lessons.length, step: 'landing' };
    deployment.checkpoint = { ...ctx.checkpoint };
    await report(80, 'Page de présentation renseignée');

    // 5) Soumission à la revue.
    await adapter.submitForReview(ctx);
    ctx.checkpoint = { lessonIndex: lessons.length, step: 'review' };
    deployment.checkpoint = { ...ctx.checkpoint };
    await report(92, 'Cours soumis à la revue');

    // 6) Statut final.
    const status = await adapter.getStatus(ctx);
    deployment.status = status.status;
    if (status.externalUrl) deployment.externalUrl = status.externalUrl;
    if (ctx.externalId) (deployment as { externalId?: string }).externalId = ctx.externalId;
    deployment.checkpoint = { lessonIndex: lessons.length, step: 'done' };

    // Instantané des leçons déployées (P46) : base du futur diff de mise à jour.
    // On repart d'un instantané vide et on marque les leçons 'ready' uploadées.
    const plan = detectLessonUpdates(lessons, []);
    await writeDeployedSnapshot(ctx, nextSnapshot([], plan.updates));

    deployment.logs.push({
      ts: new Date(),
      level: 'info',
      msg: `${mock ? '[mock] ' : ''}déploiement terminé : ${status.status}${status.reviewState ? ` (${status.reviewState})` : ''}`,
    });
    await deployment.save();

    await report(100, `Déploiement terminé : ${status.status}`);
    logger.info(
      { courseId, platform, status: status.status, externalUrl: status.externalUrl },
      'déploiement terminé',
    );

    // Notification (P59) — déploiement terminé (in-app + email best-effort).
    try {
      const title = course.title ?? 'votre cours';
      let actionUrl: string | undefined = status.externalUrl;
      if (!actionUrl) {
        try {
          actionUrl = `${config.APP_URL}/dashboard/courses/${courseId}`;
        } catch {
          actionUrl = undefined;
        }
      }
      await notify(String(userId), {
        type: 'deployment_complete',
        title: 'Déploiement terminé',
        body: `Le cours « ${title} » a été déployé sur ${platform}.`,
        link: `/dashboard/courses/${courseId}`,
        emailData: { courseTitle: title, platform, actionUrl },
      });
    } catch (err) {
      logger.warn({ courseId, platform, err }, 'notification deployment_complete non émise');
    }

    return {
      platform,
      status: status.status,
      externalId: ctx.externalId,
      externalUrl: status.externalUrl,
      reviewState: status.reviewState,
      lessonsUploaded,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Échec : statut 'failed', erreur structurée, checkpoint PRÉSERVÉ pour reprise.
    deployment.status = 'failed';
    deployment.logs.push({ ts: new Date(), level: 'error', msg: `échec du déploiement : ${message}` });
    await deployment.save().catch(() => undefined);
    logger.error({ courseId, platform, checkpoint: deployment.checkpoint, err }, 'échec du déploiement');
    await report(0, `Échec du déploiement : ${message}`, 'error').catch(() => undefined);
    throw err;
  }
}
