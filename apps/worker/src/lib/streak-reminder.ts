// Rappel quotidien de série (Prompt 200) — cron BullMQ repeatable, même patron
// que lib/email-sequence.ts / lib/course-refresh.ts :
//
//  1) selectProfilesAtRisk : PUR côté décision — délègue à isStreakAtRisk
//     (@sallycourse/shared/gamification) : une série est « en danger » quand
//     l'apprenant était actif HIER (jour UTC) mais pas encore aujourd'hui.
//  2) sendStreakReminders : notification in-app (notify, type 'streak_reminder')
//     + Web Push sur chaque abonnement du navigateur (sendWebPush, mock-friendly
//     si VAPID absent). AUCUN email (décision produit).
//  3) Idempotence : GamificationProfile.lastStreakReminderDay — au plus un
//     rappel par jour UTC, même si le job est rejoué.
import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import {
  GamificationProfile,
  PushSubscription,
  dayKeyUtc,
  isStreakAtRisk,
  notify,
  sendWebPush,
  type IGamificationProfile,
} from '../shared.js';
import { getRedisConnection } from '../queues/connection.js';
import { logger } from '../queues/index.js';

/* ------------------------------------------------------------------ */
/* 1) Sélection des séries en danger                                    */
/* ------------------------------------------------------------------ */

/** Profil minimal manipulé par le cron (sous-ensemble de IGamificationProfile). */
export interface StreakProfileLike {
  userId: unknown;
  currentStreak: number;
  longestStreak: number;
  lastActiveDay?: string;
  lastStreakReminderDay?: string;
}

/**
 * Filtre les profils à rappeler : série en danger ET aucun rappel déjà envoyé
 * aujourd'hui (jour UTC). PURE — testable sans Mongo.
 */
export function selectProfilesToRemind<T extends StreakProfileLike>(
  profiles: readonly T[],
  now: Date,
): T[] {
  const today = dayKeyUtc(now);
  return profiles.filter((p) => {
    if (p.lastStreakReminderDay === today) return false;
    return isStreakAtRisk(
      {
        currentStreak: p.currentStreak,
        longestStreak: p.longestStreak,
        lastActiveDay: p.lastActiveDay ?? null,
      },
      now,
    );
  });
}

/** Message du rappel (in-app + push) — dépend de la longueur de la série. */
export function streakReminderMessage(currentStreak: number): { title: string; body: string } {
  return {
    title: `Votre série de ${currentStreak} jour(s) est en danger`,
    body:
      currentStreak >= 7
        ? `Terminez une leçon aujourd’hui pour ne pas perdre votre série de ${currentStreak} jours.`
        : 'Terminez une leçon aujourd’hui pour prolonger votre série.',
  };
}

/* ------------------------------------------------------------------ */
/* 2) Passage du cron                                                   */
/* ------------------------------------------------------------------ */

export interface StreakReminderRun {
  candidates: number;
  notified: number;
  pushed: number;
}

/**
 * Envoie les rappels dus. Best-effort par apprenant : un échec (notif ou push)
 * n'interrompt pas le passage. Retourne le bilan pour les logs/tests.
 */
export async function sendStreakReminders(now: Date = new Date()): Promise<StreakReminderRun> {
  const yesterday = dayKeyUtc(new Date(now.getTime() - 86_400_000));

  // Pré-filtre Mongo (index { currentStreak, lastActiveDay }) : seuls les
  // profils actifs hier peuvent être en danger — isStreakAtRisk re-vérifie.
  const profiles = await GamificationProfile.find({
    currentStreak: { $gte: 1 },
    lastActiveDay: yesterday,
  })
    .select('userId currentStreak longestStreak lastActiveDay lastStreakReminderDay')
    .lean<IGamificationProfile[]>();

  const due = selectProfilesToRemind(profiles, now);
  const today = dayKeyUtc(now);
  let notified = 0;
  let pushed = 0;

  for (const profile of due) {
    const userId = String(profile.userId);
    const { title, body } = streakReminderMessage(profile.currentStreak);

    try {
      await notify(userId, {
        type: 'streak_reminder',
        title,
        body,
        link: '/learn',
        // Pas d'email : EMAIL_TEMPLATE_BY_TYPE mappe 'streak_reminder' sur undefined.
      });
      notified += 1;
    } catch (err) {
      logger.warn({ userId, err }, 'streak-reminder : notification in-app en échec');
    }

    // Web Push sur chaque navigateur abonné (mock si VAPID non configuré).
    const subscriptions = await PushSubscription.find({ userId })
      .select('endpoint p256dh auth')
      .lean();
    for (const sub of subscriptions) {
      const result = await sendWebPush(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        { title, body, url: '/learn' },
      );
      if (result.ok) pushed += 1;
      // 404/410 = abonnement périmé côté push service : on nettoie.
      else if (result.status === 404 || result.status === 410) {
        await PushSubscription.deleteOne({ endpoint: sub.endpoint }).catch(() => undefined);
      }
    }

    // Idempotence : au plus un rappel par jour UTC.
    await GamificationProfile.updateOne(
      { userId: profile.userId },
      { $set: { lastStreakReminderDay: today } },
    ).catch((err: unknown) =>
      logger.warn({ userId, err }, 'streak-reminder : marquage du jour de rappel en échec'),
    );
  }

  logger.info(
    { candidates: due.length, notified, pushed },
    'streak-reminder : passage cron terminé',
  );
  return { candidates: due.length, notified, pushed };
}

/* ------------------------------------------------------------------ */
/* 3) Scheduler BullMQ repeatable (patron email-sequence.ts)            */
/* ------------------------------------------------------------------ */

/** Queue cron dédiée aux rappels de série (hors registre typé). */
export const STREAK_REMINDER_QUEUE = 'streak-reminder-cron';
/** Identifiant du job répétable (dédupliqué par BullMQ). */
export const STREAK_REMINDER_JOB = 'streak-reminder-daily';
/**
 * Cadence par défaut : 18 h UTC — assez tard pour ne rappeler que les
 * apprenants réellement inactifs de la journée, assez tôt pour qu'il reste du
 * temps avant minuit UTC (frontière du jour de streak). Surcharge :
 * STREAK_REMINDER_CRON.
 */
const DEFAULT_CRON = '0 18 * * *';

interface StreakReminderJobData {
  reason?: string;
}

let reminderQueue: Queue<StreakReminderJobData> | null = null;
let reminderWorker: Worker<StreakReminderJobData> | null = null;

function bullConnection(): ConnectionOptions {
  return getRedisConnection() as unknown as ConnectionOptions;
}

/**
 * Démarre le scheduler de rappels de série : queue + job répétable quotidien +
 * worker exécutant sendStreakReminders. Idempotent. Appelé depuis index.ts.
 */
export async function startStreakReminderScheduler(
  cron: string = process.env.STREAK_REMINDER_CRON?.trim() || DEFAULT_CRON,
): Promise<void> {
  if (reminderWorker) return;

  reminderQueue = new Queue<StreakReminderJobData>(STREAK_REMINDER_QUEUE, {
    connection: bullConnection(),
  });
  reminderQueue.on('error', (err) =>
    logger.error({ queue: STREAK_REMINDER_QUEUE, err }, 'erreur queue streak-reminder'),
  );

  await reminderQueue.add(
    STREAK_REMINDER_JOB,
    { reason: 'cron' },
    {
      repeat: { pattern: cron },
      jobId: STREAK_REMINDER_JOB,
      removeOnComplete: 20,
      removeOnFail: 50,
    },
  );

  reminderWorker = new Worker<StreakReminderJobData>(
    STREAK_REMINDER_QUEUE,
    async (_job: Job<StreakReminderJobData>) => sendStreakReminders(),
    { connection: bullConnection(), concurrency: 1 },
  );
  reminderWorker.on('failed', (job, err) =>
    logger.error({ queue: STREAK_REMINDER_QUEUE, jobId: job?.id, err }, 'streak-reminder : job en échec'),
  );
  reminderWorker.on('error', (err) =>
    logger.error({ queue: STREAK_REMINDER_QUEUE, err }, 'erreur worker streak-reminder'),
  );

  logger.info({ cron }, 'scheduler streak-reminder démarré');
}
/** Arrête proprement le scheduler (worker + queue). */
export async function stopStreakReminderScheduler(): Promise<void> {
  await reminderWorker?.close().catch(() => undefined);
  await reminderQueue?.close().catch(() => undefined);
  reminderWorker = null;
  reminderQueue = null;
}
