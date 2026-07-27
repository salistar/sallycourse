// Déploiements programmés — « drip » (Prompt 181).
//
// Scheduler BullMQ repeatable (même patron que lib/blog.ts / lib/email-sequence.ts :
// une queue cron dédiée hors registre typé, job répétable pattern cron, start/
// stop/triggerNow idempotents). Deux natures de travail à CHAQUE passage :
//
//  1) processDueDeploySchedules(now) — parcourt les DeploymentSchedule ACTIFS et,
//     pour chaque entrée dont l'échéance est atteinte, traite le « lot suivant »
//     selon la cadence (décision PURE déléguée à planEntryRun, cf.
//     @sallycourse/shared/deploy-schedule) :
//       · TikTok/Instagram → PROGRAMME les N prochains ShortClip 'draft'
//         (scheduleClipPublish → status 'scheduled', scheduledAt=now) ; c'est
//         publishDueShortClips (même passage) qui les publie RÉELLEMENT. La
//         GÉNÉRATION des clips (renderShortClips, P106) est une étape SÉPARÉE non
//         câblée ici — le drip ne fait que publier des ShortClip déjà produits ;
//         une entrée clip sans aucun ShortClip reste active/idle (pas de fausse
//         clôture, cf. isEntryComplete).
//       · plateformes de cours (Udemy/YouTube/…) → enfile le déploiement complet
//         du cours (unité unique) via la queue 'deployment', comme la route web.
//     Puis avance cursor + nextRunAt, et clôt le plan quand toutes les entrées
//     sont terminées.
//
//  2) publishDueShortClips(now) — MAILLON MANQUANT du drip TikTok (calque sur
//     publishDueBlogPosts) : publie les ShortClip programmés (status 'scheduled',
//     scheduledAt <= now) posés par scheduleClipPublish (P106), indépendamment
//     d'un plan drip. Best-effort par clip.
//
// MOCK : publishScheduledClip est déjà mock-friendly (aucun réseau sans
// credentials / MOCK_PROVIDERS), et l'enfilage 'deployment' est traité par le
// processor existant (lui-même mock-friendly). Aucune dépense hors production.
import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import {
  Course,
  Deployment,
  DeploymentSchedule,
  PlatformCredential,
  ShortClip,
  QUEUES,
  SHORT_CLIP_PLATFORMS,
  decryptCredentials,
  defaultJobOptions,
  getConfig,
  makeJobId,
  planEntryRun,
  isEntryComplete,
  type DeploymentScheduleDocument,
  type IDeploymentScheduleEntry,
  type DripEntryState,
  type ShortClipDocument,
  type ShortClipPlatform,
} from '../shared.js';
import { getRedisConnection } from '../queues/connection.js';
import { createQueue, logger } from '../queues/index.js';
import { publishScheduledClip, scheduleClipPublish } from '../deploy/adapters/shorts-repurposing.js';

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

/** Queue cron dédiée au drip (hors registre typé, comme blog/email-sequence). */
export const DEPLOY_SCHEDULE_QUEUE = 'deploy-schedule-cron';
/** Identifiant du job répétable (dédupliqué par BullMQ). */
export const DEPLOY_SCHEDULE_JOB = 'deploy-schedule-due-hourly';
/** Cadence par défaut : toutes les heures (surchargée par DEPLOY_SCHEDULE_CRON). */
const DEFAULT_CRON = '0 * * * *';
/** Bornes de charge par passage. */
const MAX_SCHEDULES_PER_RUN = 200;
const MAX_CLIPS_PER_RUN = 500;

/** Statuts de ShortClip encore publiables (non encore en ligne). */
const PUBLISHABLE_CLIP_STATUSES = ['draft', 'scheduled'] as const;

/** Une plateforme de clips courts (drip clip-par-clip) ? */
function isClipPlatform(platform: string): platform is ShortClipPlatform {
  return (SHORT_CLIP_PLATFORMS as readonly string[]).includes(platform);
}

/* ------------------------------------------------------------------ */
/* Credentials plateforme (best-effort, mock-friendly)                 */
/* ------------------------------------------------------------------ */

/**
 * Charge et déchiffre les credentials d'un utilisateur pour une plateforme
 * (vide en mock ou si absents/illisibles — publishScheduledClip retombe alors
 * sur la simulation). Ne jette jamais.
 */
async function loadPlatformCredentials(
  userId: unknown,
  platform: string,
  mock: boolean,
): Promise<Record<string, string>> {
  if (mock) return {};
  try {
    const cred = await PlatformCredential.findOne({ userId, platform }).lean<{ data?: string } | null>();
    if (!cred?.data) return {};
    return decryptCredentials(cred.data, getConfig().CREDENTIALS_MASTER_KEY);
  } catch (err) {
    logger.warn({ platform, err }, 'drip : credentials illisibles — publication simulée');
    return {};
  }
}

/* ------------------------------------------------------------------ */
/* 1) Publication des ShortClip programmés dus (maillon manquant)      */
/* ------------------------------------------------------------------ */

/**
 * Publie les ShortClip programmés arrivés à échéance (status 'scheduled',
 * scheduledAt <= now) via publishScheduledClip. Best-effort par clip — un échec
 * bascule le clip en 'failed' (dans publishScheduledClip) sans interrompre les
 * suivants. Les credentials sont mémorisés par (courseId, platform) le temps du
 * passage pour éviter les relectures.
 */
export async function publishDueShortClips(now: Date = new Date()): Promise<{ published: number; failed: number }> {
  const mock = getConfig().MOCK_PROVIDERS;
  const clips = await ShortClip.find({ status: 'scheduled', scheduledAt: { $lte: now } })
    .sort({ scheduledAt: 1 })
    .limit(MAX_CLIPS_PER_RUN);

  let published = 0;
  let failed = 0;
  const credCache = new Map<string, Record<string, string>>();
  const ownerCache = new Map<string, unknown>();

  for (const clip of clips) {
    try {
      const courseKey = String(clip.courseId);
      let userId = ownerCache.get(courseKey);
      if (userId === undefined) {
        const course = await Course.findById(clip.courseId).select('userId').lean<{ userId?: unknown } | null>();
        userId = course?.userId ?? null;
        ownerCache.set(courseKey, userId);
      }
      const cacheKey = `${courseKey}:${clip.platform}`;
      let credentials = credCache.get(cacheKey);
      if (!credentials) {
        credentials = await loadPlatformCredentials(userId, clip.platform, mock);
        credCache.set(cacheKey, credentials);
      }
      await publishScheduledClip(clip, credentials);
      published += 1;
    } catch (err) {
      failed += 1;
      logger.warn({ clipId: String(clip._id), err }, 'drip : publication de clip programmé échouée');
    }
  }

  if (published || failed) logger.info({ published, failed }, 'drip : passage de publication des clips terminé');
  return { published, failed };
}

/* ------------------------------------------------------------------ */
/* 2) Traitement des plans drip actifs                                 */
/* ------------------------------------------------------------------ */

/** Convertit une entrée persistée en état runtime pur (pour planEntryRun). */
function toEntryState(entry: IDeploymentScheduleEntry): DripEntryState {
  return {
    platform: entry.platform,
    cadence: entry.cadence as DripEntryState['cadence'],
    cursor: entry.cursor ?? 0,
    nextRunAt: entry.nextRunAt ?? null,
  };
}

/**
 * Nombre d'éléments encore publiables pour une plateforme d'un cours :
 *  - clips (tiktok/instagram) : ShortClip non encore publiés ;
 *  - plateformes de cours : le cours est une unité unique → 1 tant que rien n'a
 *    été publié (cursor 0), sinon 0.
 */
async function remainingItemsFor(
  courseId: unknown,
  entry: IDeploymentScheduleEntry,
): Promise<number> {
  if (isClipPlatform(entry.platform)) {
    return ShortClip.countDocuments({
      courseId,
      platform: entry.platform,
      status: { $in: [...PUBLISHABLE_CLIP_STATUSES] },
    });
  }
  return (entry.cursor ?? 0) < 1 ? 1 : 0;
}

/**
 * Publie effectivement `count` éléments pour une entrée et retourne le nombre
 * RÉELLEMENT publié (peut être < count si un échec survient — le cursor n'avance
 * que des succès, le reste sera retenté au prochain passage).
 */
async function publishEntryItems(
  schedule: DeploymentScheduleDocument,
  entry: IDeploymentScheduleEntry,
  count: number,
  now: Date,
  _mock: boolean,
): Promise<number> {
  if (count <= 0) return 0;

  if (isClipPlatform(entry.platform)) {
    // finding 7 : le drip PROGRAMME les prochains ShortClip 'draft' existants
    // (scheduleClipPublish → status 'scheduled', scheduledAt=now) pour que
    // publishDueShortClips (même passage) les publie RÉELLEMENT — au lieu de
    // laisser scheduleClipPublish en code mort. Aucun clip 'draft' → no-op (et
    // pas de fausse clôture, cf. isEntryComplete). La génération des clips
    // (renderShortClips, P106) reste une étape séparée non câblée ici.
    const clips = (await ShortClip.find({
      courseId: schedule.courseId,
      platform: entry.platform,
      status: 'draft',
    })
      .sort({ order: 1 })
      .limit(count)) as ShortClipDocument[];
    if (clips.length === 0) return 0;
    // intervalHours=0 : tous dus à `now`, publiés dès ce passage par publishDueShortClips.
    await scheduleClipPublish(clips, now, 0);
    return clips.length;
  }

  // Plateforme de cours : enfile le déploiement complet (unité unique), en
  // pré-créant le Deployment 'pending' pour un retour immédiat côté tableau de
  // bord (miroir de la route web /deploy). jobId distinct ('…_drip') pour ne pas
  // entrer en collision avec un déploiement manuel du même cours/plateforme.
  try {
    await Deployment.findOneAndUpdate(
      { courseId: schedule.courseId, platform: entry.platform },
      {
        $set: { status: 'pending', mode: 'auto' },
        $setOnInsert: {
          courseId: schedule.courseId,
          userId: schedule.userId,
          platform: entry.platform,
          checkpoint: { lessonIndex: 0, step: '' },
          logs: [],
        },
      },
      { upsert: true, new: true },
    );
    const queue = createQueue(QUEUES.deployment);
    const jobId = makeJobId(String(schedule.courseId), QUEUES.deployment, entry.platform, 'drip');
    await queue.remove(jobId).catch(() => undefined);
    await queue.add(
      'deploy-course',
      {
        courseId: String(schedule.courseId),
        platform: entry.platform,
        userId: String(schedule.userId),
        mode: 'auto',
      },
      { ...defaultJobOptions, jobId },
    );
    return 1;
  } catch (err) {
    logger.warn({ courseId: String(schedule.courseId), platform: entry.platform, err }, 'drip : enfilage déploiement échoué');
    return 0;
  }
}

export interface DeployScheduleOutcome {
  scheduleId: string;
  courseId: string;
  published: number;
  jobsEnqueued: number;
  completed: boolean;
}

/**
 * Traite UN plan drip : pour chaque entrée due, décide (planEntryRun) puis publie
 * le lot, avance cursor/nextRunAt du nombre réellement publié, et clôt le plan
 * quand toutes les entrées sont terminées. Best-effort par entrée. Retourne le
 * bilan, ou null si rien n'a bougé.
 */
export async function processDeploySchedule(
  schedule: DeploymentScheduleDocument,
  now: Date,
  mock: boolean,
): Promise<DeployScheduleOutcome> {
  let published = 0;
  let jobsEnqueued = 0;
  const finished: boolean[] = [];

  for (const entry of schedule.entries) {
    const state = toEntryState(entry);
    const remaining = await remainingItemsFor(schedule.courseId, entry);
    const plan = planEntryRun(state, remaining, now);

    let actual = 0;
    if (plan.publishCount > 0) {
      actual = await publishEntryItems(schedule, entry, plan.publishCount, now, mock);
      if (isClipPlatform(entry.platform)) published += actual;
      else jobsEnqueued += actual;
    }

    // Avance du cursor bornée aux succès réels (les échecs seront retentés).
    entry.cursor = (entry.cursor ?? 0) + actual;
    // Re-planification : on avance l'échéance si un passage a eu lieu, sinon on
    // conserve l'échéance courante (entrée non due ou rien de publiable).
    if (actual > 0 && plan.nextRunAt) entry.nextRunAt = plan.nextRunAt;

    // Terminée : par nombre de passages OU par épuisement RÉEL des éléments
    // (cursor > 0) — jamais sur un total de 0 (finding 6, isEntryComplete).
    // Basé sur `actual` (succès réels) pour ne pas clôturer si un item a échoué.
    const remainingAfter = remaining - actual;
    finished.push(isEntryComplete(toEntryState(entry), remainingAfter));
  }

  const completed = finished.length > 0 && finished.every(Boolean);
  if (completed) schedule.status = 'completed';
  await schedule.save().catch((err) =>
    logger.warn({ scheduleId: String(schedule._id), err }, 'drip : sauvegarde du plan échouée'),
  );

  return {
    scheduleId: String(schedule._id),
    courseId: String(schedule.courseId),
    published,
    jobsEnqueued,
    completed,
  };
}

/**
 * Parcourt tous les plans drip ACTIFS dont au moins une entrée est due
 * (entries.nextRunAt <= now) et les traite. Chaque plan est isolé (une erreur
 * n'interrompt pas les autres).
 */
export async function processDueDeploySchedules(now: Date = new Date()): Promise<DeployScheduleOutcome[]> {
  const mock = getConfig().MOCK_PROVIDERS;
  const schedules = await DeploymentSchedule.find({
    status: 'active',
    'entries.nextRunAt': { $lte: now },
  }).limit(MAX_SCHEDULES_PER_RUN);

  const outcomes: DeployScheduleOutcome[] = [];
  for (const schedule of schedules as DeploymentScheduleDocument[]) {
    try {
      outcomes.push(await processDeploySchedule(schedule, now, mock));
    } catch (err) {
      logger.error({ scheduleId: String(schedule._id), err }, 'drip : échec sur un plan');
    }
  }
  if (outcomes.length) logger.info({ schedules: outcomes.length }, 'drip : passage des plans terminé');
  return outcomes;
}

/* ------------------------------------------------------------------ */
/* Scheduler BullMQ repeatable (queue dédiée)                          */
/* ------------------------------------------------------------------ */

interface DeployScheduleJobData {
  reason?: string;
}

let scheduleQueue: Queue<DeployScheduleJobData> | null = null;
let scheduleWorker: Worker<DeployScheduleJobData> | null = null;

function bullConnection(): ConnectionOptions {
  return getRedisConnection() as unknown as ConnectionOptions;
}

/**
 * Passage complet du drip : plans actifs dus + clips programmés dus. Les deux
 * natures sont indépendantes et best-effort ; un échec de l'une n'empêche pas
 * l'autre.
 */
async function runDeployScheduleTick(): Promise<void> {
  const now = new Date();
  await processDueDeploySchedules(now).catch((err) => logger.error({ err }, 'drip : plans en échec'));
  await publishDueShortClips(now).catch((err) => logger.error({ err }, 'drip : clips programmés en échec'));
}

/**
 * Démarre le scheduler drip : queue, job répétable (cron horaire) et worker.
 * Idempotent. À appeler depuis index.ts.
 */
export async function startDeployScheduleScheduler(
  cron: string = process.env.DEPLOY_SCHEDULE_CRON?.trim() || DEFAULT_CRON,
): Promise<void> {
  if (scheduleWorker) return;

  scheduleQueue = new Queue<DeployScheduleJobData>(DEPLOY_SCHEDULE_QUEUE, { connection: bullConnection() });
  scheduleQueue.on('error', (err) => logger.error({ queue: DEPLOY_SCHEDULE_QUEUE, err }, 'erreur queue deploy-schedule'));

  await scheduleQueue.add(
    DEPLOY_SCHEDULE_JOB,
    { reason: 'cron' },
    { repeat: { pattern: cron }, jobId: DEPLOY_SCHEDULE_JOB, removeOnComplete: 20, removeOnFail: 50 },
  );

  scheduleWorker = new Worker<DeployScheduleJobData>(
    DEPLOY_SCHEDULE_QUEUE,
    async (_job: Job<DeployScheduleJobData>) => runDeployScheduleTick(),
    { connection: bullConnection(), concurrency: 1 },
  );
  scheduleWorker.on('failed', (job, err) =>
    logger.error({ queue: DEPLOY_SCHEDULE_QUEUE, jobId: job?.id, err }, 'drip : job en échec'),
  );
  scheduleWorker.on('error', (err) => logger.error({ queue: DEPLOY_SCHEDULE_QUEUE, err }, 'erreur worker deploy-schedule'));

  logger.info({ cron }, 'scheduler drip (déploiements programmés) démarré');
}
/** Arrête proprement le scheduler (worker + queue). */
export async function stopDeployScheduleScheduler(): Promise<void> {
  await scheduleWorker?.close().catch(() => undefined);
  await scheduleQueue?.close().catch(() => undefined);
  scheduleWorker = null;
  scheduleQueue = null;
}
