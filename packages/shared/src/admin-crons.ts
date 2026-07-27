/**
 * Registre des crons déclenchables MANUELLEMENT depuis la console admin (P57).
 * Chaque entrée cible la queue BullMQ du scheduler worker ; côté web, l'admin
 * enfile un job `${job}:manual` avec `{ reason: 'manual' }` — exactement ce que
 * font les fonctions `triggerXxxNow()` du worker (les workers de ces queues
 * traitent tout job, y compris le job manuel).
 *
 * IMPORTANT : `queue`/`job` DOIVENT rester identiques aux constantes du worker
 * (`RETENTION_QUEUE`/`RETENTION_JOB`, etc.). Source unique côté produit ici.
 */
export interface AdminCronTrigger {
  /** Identifiant stable (clé i18n `admin.crons.<key>` + payload de la route). */
  key: string;
  /** Nom de la queue BullMQ (doit matcher le worker). */
  queue: string;
  /** Nom de job de base (le web ajoute le suffixe `:manual`). */
  job: string;
}

export const ADMIN_CRON_TRIGGERS: readonly AdminCronTrigger[] = [
  { key: 'retention', queue: 'retention-archive', job: 'retention-archive-daily' },
  { key: 'analytics', queue: 'analytics-refresh', job: 'analytics-refresh-daily' },
  { key: 'emailSequence', queue: 'email-sequence-cron', job: 'email-sequence-due-hourly' },
  { key: 'deploySchedule', queue: 'deploy-schedule-cron', job: 'deploy-schedule-due-hourly' },
  { key: 'courseRefresh', queue: 'course-refresh', job: 'course-refresh-quarterly' },
  { key: 'streakReminder', queue: 'streak-reminder-cron', job: 'streak-reminder-daily' },
  { key: 'abTesting', queue: 'landing-ab-testing', job: 'landing-ab-testing-weekly' },
  { key: 'reviewPoll', queue: 'review-poll', job: 'review-poll-daily' },
] as const;

/** Clés valides (validation de payload côté route). */
export const ADMIN_CRON_KEYS: readonly string[] = ADMIN_CRON_TRIGGERS.map((t) => t.key);
