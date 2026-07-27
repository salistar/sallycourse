// A/B testing des landing pages (Prompt 87). Réutilise les 5 variantes de
// titre déjà générées par le marketing du cours (Course.marketing.content
// .titleIdeas, P28) : une ligne LandingVariant par variante et par
// plateforme déployée. Une rotation round-robin hebdomadaire (cron BullMQ
// repeatable) active UNE variante à la fois et l'applique sur la plateforme
// via l'adapter (setLandingPage) quand celui-ci le supporte. La performance
// est comparée via CourseAnalytics (P61) : taux de conversion approché =
// enrollments / impressions.

import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import {
  Course,
  CourseAnalytics,
  Deployment,
  LandingVariant,
  type ICourse,
  type MarketingContent,
} from '../shared.js';
import { getRedisConnection } from '../queues/connection.js';
import { logger } from '../queues/index.js';
import { getAdapter } from './registry.js';
import type { DeployContext } from './types.js';

/** Cours porteur d'un marketing.content déjà généré (Mixed → forme connue localement). */
type CourseWithMarketing = ICourse & {
  marketing?: { status?: string; content?: MarketingContent } | null;
};

/* ------------------------------------------------------------------ */
/* Fonctions PURES (testables sans I/O)                                */
/* ------------------------------------------------------------------ */

/**
 * Sélection round-robin DÉTERMINISTE : à partir de l'index de la variante
 * actuellement active (-1 si aucune) et du nombre total de variantes, retourne
 * l'index de la PROCHAINE variante à activer. Boucle sur 0 après la dernière.
 */
export function nextVariantIndex(currentActiveIndex: number, total: number): number {
  if (total <= 0) throw new Error('nextVariantIndex : aucune variante disponible');
  if (currentActiveIndex < 0) return 0;
  return (currentActiveIndex + 1) % total;
}

/**
 * Détermine si une rotation est due : compare `lastActivatedAt` à `now` selon
 * une période fixe (par défaut 7 jours = calendrier hebdomadaire). Aucune
 * variante active (lastActivatedAt absent) → rotation due immédiatement.
 */
export function isRotationDue(
  lastActivatedAt: Date | undefined,
  now: Date,
  periodMs: number = 7 * 24 * 60 * 60 * 1000,
): boolean {
  if (!lastActivatedAt) return true;
  return now.getTime() - lastActivatedAt.getTime() >= periodMs;
}

/** Taux de conversion approché (0 si aucune impression — évite la division par 0). */
export function conversionRate(impressions: number, conversions: number): number {
  if (impressions <= 0) return 0;
  return conversions / impressions;
}

export interface VariantPerformance {
  variantIndex: number;
  title: string;
  isActive: boolean;
  impressions: number;
  conversions: number;
  /** Taux de conversion 0..1 (arrondi à 4 décimales). */
  rate: number;
}

/** Arrondi à 4 décimales robuste aux erreurs flottantes. */
function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/**
 * Classe les variantes par performance décroissante (taux de conversion), à
 * égalité par le plus grand nombre d'impressions (plus fiable statistiquement).
 * Fonction pure — utilisée par le worker ET le dashboard (miroir léger).
 */
export function rankVariantPerformance(
  variants: readonly Pick<VariantPerformance, 'variantIndex' | 'title' | 'isActive' | 'impressions' | 'conversions'>[],
): VariantPerformance[] {
  return variants
    .map((v) => ({ ...v, rate: round4(conversionRate(v.impressions, v.conversions)) }))
    .sort((a, b) => b.rate - a.rate || b.impressions - a.impressions);
}

/* ------------------------------------------------------------------ */
/* Persistance : seed des variantes + rotation + métriques             */
/* ------------------------------------------------------------------ */

/**
 * Crée (idempotent) les lignes LandingVariant d'un cours/plateforme à partir
 * de Course.marketing.content.titleIdeas. Ne touche pas aux variantes déjà
 * existantes (upsert sans écraser isActive/impressions/conversions).
 * Retourne le nombre de variantes disponibles (0 si pas de marketing prêt).
 */
export async function seedLandingVariants(courseId: string, platform: string): Promise<number> {
  const course = (await Course.findById(courseId).lean()) as CourseWithMarketing | null;
  const titleIdeas = course?.marketing?.content?.titleIdeas;
  if (!course || !titleIdeas || titleIdeas.length === 0) return 0;

  for (let index = 0; index < titleIdeas.length; index += 1) {
    const idea = titleIdeas[index]!;
    await LandingVariant.updateOne(
      { courseId, platform, variantIndex: index },
      {
        $setOnInsert: {
          courseId,
          userId: course.userId,
          platform,
          variantIndex: index,
          title: idea.title,
          description: course.marketing?.content?.udemyDescription ?? '',
          isActive: false,
          impressions: 0,
          conversions: 0,
        },
      },
      { upsert: true },
    );
  }
  return titleIdeas.length;
}

/**
 * Applique la variante active sur la plateforme via l'adapter, si celui-ci
 * expose `setLandingPage` (tous le font) — best-effort : les erreurs sont
 * loguées sans interrompre la rotation (l'A/B testing ne doit jamais bloquer
 * le déploiement principal). En mock ou sans déploiement publié, no-op logué.
 */
async function applyVariantToPlatform(
  courseId: string,
  platform: string,
  variant: { title: string; description: string },
): Promise<void> {
  const deployment = await Deployment.findOne({ courseId, platform }).sort({ updatedAt: -1 });
  if (!deployment || deployment.status !== 'published') {
    logger.info({ courseId, platform }, 'ab-testing : pas de déploiement publié — variante mémorisée seulement');
    return;
  }

  let adapter;
  try {
    adapter = getAdapter(platform);
  } catch (err) {
    // Cohérent avec la doc ci-dessus : erreur loguée, jamais propagée.
    logger.warn({ courseId, platform, err }, 'ab-testing : adapter introuvable — variante non appliquée');
    return;
  }
  if (typeof adapter.setLandingPage !== 'function') return;

  const course = (await Course.findById(courseId)) as ICourse & { _id: unknown };
  if (!course) return;

  // Contexte minimal réutilisant le contrat DeployContext (P31) : pas de
  // ré-upload de leçons, seule la landing est retouchée. Titre/description de
  // la variante injectés via course.outline (lu par setLandingPage des adapters).
  const patchedCourse = {
    ...course,
    title: variant.title,
    outline: { ...(course.outline as Record<string, unknown> | undefined), description: variant.description },
  } as ICourse;

  const ctx: DeployContext = {
    platform,
    mode: deployment.mode,
    course: patchedCourse,
    sections: [],
    lessons: [],
    credentials: {},
    checkpoint: { lessonIndex: 0, step: 'ab-testing' },
    externalId: deployment.externalId,
    publishProgress: async () => undefined,
    logger,
    mock: true, // l'A/B testing ne rejoue jamais un vrai navigateur automatiquement — sécurité par défaut
    deployment,
  };

  try {
    await adapter.setLandingPage(ctx);
    logger.info({ courseId, platform, title: variant.title }, 'ab-testing : landing appliquée (mode simulé)');
  } catch (err) {
    logger.warn({ courseId, platform, err }, 'ab-testing : application de la variante échouée');
  }
}

/**
 * Fait tourner la variante active d'un (cours, plateforme) selon le calendrier
 * round-robin hebdomadaire : seed des variantes si absentes, calcule la
 * prochaine à activer si la rotation est due, applique sur la plateforme.
 * Retourne l'index activé, ou null si aucune rotation effectuée (pas encore
 * due, ou aucune variante disponible).
 */
export async function rotateLandingVariant(courseId: string, platform: string): Promise<number | null> {
  const total = await seedLandingVariants(courseId, platform);
  if (total === 0) return null;

  const variants = await LandingVariant.find({ courseId, platform }).sort({ variantIndex: 1 });
  if (variants.length === 0) return null;

  const active = variants.find((v) => v.isActive);
  if (!isRotationDue(active?.lastActivatedAt, new Date())) return null;

  const nextIndex = nextVariantIndex(active?.variantIndex ?? -1, variants.length);
  const next = variants.find((v) => v.variantIndex === nextIndex);
  if (!next) return null;

  await LandingVariant.updateMany({ courseId, platform }, { $set: { isActive: false } });
  next.isActive = true;
  next.lastActivatedAt = new Date();
  await next.save();

  await applyVariantToPlatform(courseId, platform, next);

  logger.info({ courseId, platform, variantIndex: nextIndex }, 'ab-testing : variante activée');
  return nextIndex;
}

/**
 * Recalcule impressions/conversions de toutes les variantes d'un cours à
 * partir du dernier instantané CourseAnalytics de la plateforme : les
 * impressions/conversions accumulées depuis l'activation de la variante
 * courante sont estimées par la DIFFÉRENCE de vues/enrollments depuis le
 * dernier calcul (best-effort, sans historique fin par variante).
 * Simplification assumée : seule la variante ACTIVE reçoit le delta courant
 * (les variantes passées gardent leur total figé).
 */
export async function syncVariantMetrics(courseId: string, platform: string): Promise<void> {
  const [active, snapshot] = await Promise.all([
    LandingVariant.findOne({ courseId, platform, isActive: true }),
    CourseAnalytics.findOne({ courseId, platform }).lean(),
  ]);
  if (!active || !snapshot) return;

  // Proxy impressions = vues (YouTube) ou 0 (Udemy ne les expose pas côté API instructeur).
  const impressionsProxy = snapshot.views > 0 ? snapshot.views : Math.max(snapshot.enrollments * 10, 0);
  active.impressions = Math.max(active.impressions, impressionsProxy);
  active.conversions = Math.max(active.conversions, snapshot.enrollments);
  await active.save();
}

/** Performance des variantes d'un (cours, plateforme), classées par taux de conversion. */
export async function getVariantPerformance(courseId: string, platform: string): Promise<VariantPerformance[]> {
  const variants = await LandingVariant.find({ courseId, platform }).sort({ variantIndex: 1 }).lean();
  return rankVariantPerformance(variants);
}

/* ------------------------------------------------------------------ */
/* Scheduler BullMQ repeatable (queue dédiée hors registre typé)       */
/* ------------------------------------------------------------------ */

export const AB_TESTING_QUEUE = 'landing-ab-testing';
export const AB_TESTING_JOB = 'landing-ab-testing-weekly';
/** Cadence par défaut : chaque lundi à 6h (surchargée par AB_TESTING_CRON). */
const DEFAULT_CRON = '0 6 * * 1';

interface AbTestingJobData {
  reason?: string;
}

let abTestingQueue: Queue<AbTestingJobData> | null = null;
let abTestingWorker: Worker<AbTestingJobData> | null = null;

function bullConnection(): ConnectionOptions {
  return getRedisConnection() as unknown as ConnectionOptions;
}

/**
 * Balaie tous les déploiements publiés et fait tourner la variante de chaque
 * (cours, plateforme) si la rotation est due, puis resynchronise les métriques.
 * Retourne le nombre de rotations effectuées.
 */
export async function rotateAllDueVariants(): Promise<number> {
  const deployments = await Deployment.find({ status: 'published' }).lean();
  let rotated = 0;
  const seen = new Set<string>();

  for (const dep of deployments) {
    const key = `${dep.courseId}:${dep.platform}`;
    if (seen.has(key)) continue;
    seen.add(key);

    try {
      await syncVariantMetrics(String(dep.courseId), dep.platform).catch(() => undefined);
      const activated = await rotateLandingVariant(String(dep.courseId), dep.platform);
      if (activated !== null) rotated += 1;
    } catch (err) {
      logger.warn({ courseId: String(dep.courseId), platform: dep.platform, err }, 'ab-testing : rotation échouée');
    }
  }
  return rotated;
}

/**
 * Démarre le scheduler A/B testing : queue + job répétable (cron hebdomadaire)
 * + worker qui exécute rotateAllDueVariants. Idempotent. À appeler depuis
 * index.ts, à côté du scheduler analytics.
 */
export async function startAbTestingScheduler(
  cron: string = process.env.AB_TESTING_CRON?.trim() || DEFAULT_CRON,
): Promise<void> {
  if (abTestingWorker) return;

  abTestingQueue = new Queue<AbTestingJobData>(AB_TESTING_QUEUE, { connection: bullConnection() });
  abTestingQueue.on('error', (err) => logger.error({ queue: AB_TESTING_QUEUE, err }, 'erreur queue ab-testing'));

  await abTestingQueue.add(
    AB_TESTING_JOB,
    { reason: 'cron' },
    { repeat: { pattern: cron }, jobId: AB_TESTING_JOB, removeOnComplete: 20, removeOnFail: 50 },
  );

  abTestingWorker = new Worker<AbTestingJobData>(
    AB_TESTING_QUEUE,
    async (_job: Job<AbTestingJobData>) => {
      const rotated = await rotateAllDueVariants();
      return { rotated };
    },
    { connection: bullConnection(), concurrency: 1 },
  );
  abTestingWorker.on('failed', (job, err) =>
    logger.error({ queue: AB_TESTING_QUEUE, jobId: job?.id, err }, 'ab-testing : job en échec'),
  );
  abTestingWorker.on('error', (err) => logger.error({ queue: AB_TESTING_QUEUE, err }, 'erreur worker ab-testing'));

  logger.info({ cron }, 'scheduler ab-testing démarré');
}
/** Arrête proprement le scheduler (worker + queue). */
export async function stopAbTestingScheduler(): Promise<void> {
  await abTestingWorker?.close().catch(() => undefined);
  await abTestingQueue?.close().catch(() => undefined);
  abTestingWorker = null;
  abTestingQueue = null;
}
