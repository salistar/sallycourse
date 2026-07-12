// Journal d'audit transversal (Prompt 149) — partie PURE, sans dépendance
// Mongo (packages/shared ne dépend jamais de @sallycourse/db). L'écriture
// réelle en base vit dans packages/db/src/audit-service.ts (comme
// notification-service.ts pour les notifications) et réutilise les types et
// la logique de rétention définis ici.
//
// IMMUABLE PAR CONCEPTION : AuditLog (packages/db/src/models/audit-log.ts)
// n'expose aucune méthode update/delete métier — seule la création
// (recordAudit) et la purge par rétention (fonction pure ci-dessous, appelée
// par le cron worker) touchent la collection, et la purge ne fait que
// supprimer les entrées expirées, jamais les modifier.

/** Actions auditées — doit rester synchronisé avec AUDIT_ACTIONS du modèle. */
export const AUDIT_ACTIONS = [
  'login',
  'login.failed',
  'register',
  'logout',
  'credentials.changed',
  'credentials.deleted',
  'deployment.created',
  'course.deleted',
  'admin.access',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_TARGET_TYPES = [
  'user',
  'course',
  'platform_credential',
  'deployment',
  'admin_page',
] as const;
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

/** Entrée à journaliser — fournie par l'appelant (route API, worker). */
export interface AuditEntryInput {
  userId?: string;
  action: AuditAction;
  targetType?: AuditTargetType;
  targetId?: string;
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

/** Fonction d'écriture réelle injectée par l'appelant (ex : AuditLog.create côté packages/db). */
export type AuditWriter = (entry: AuditEntryInput & { createdAt: Date }) => Promise<unknown>;

/**
 * Enregistre une entrée d'audit via le writer fourni — BEST-EFFORT : ne jette
 * JAMAIS, même si `writer` échoue (Mongo indisponible, validation, etc.). Le
 * flux métier appelant (login, déploiement, suppression de cours...) ne doit
 * jamais être bloqué par une panne du journal d'audit.
 */
export async function recordAudit(entry: AuditEntryInput, writer: AuditWriter): Promise<void> {
  try {
    await writer({ ...entry, createdAt: new Date() });
  } catch {
    // Best-effort : une panne du journal d'audit ne doit jamais remonter.
  }
}

/* ------------------------------------------------------------------ */
/* Rétention (12 mois) — purge PURE, testable sans Mongo               */
/* ------------------------------------------------------------------ */

/** Durée de rétention légale par défaut : 12 mois (365 jours). */
export const AUDIT_RETENTION_DAYS = 365;

/**
 * Calcule la date-seuil (exclue) : toute entrée avec `createdAt < seuil` doit
 * être purgée. Fonction pure — l'appelant fournit `now` pour rester
 * déterministe dans les tests.
 */
export function computeAuditRetentionCutoff(
  now: Date = new Date(),
  retentionDays: number = AUDIT_RETENTION_DAYS,
): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

/** Forme minimale nécessaire au filtrage par rétention. */
export interface AuditLogRetentionEntry {
  id: string;
  createdAt: Date;
}

/**
 * Sélectionne, parmi une liste d'entrées déjà chargées, celles plus anciennes
 * que la fenêtre de rétention (à purger). Pure — aucune I/O ; le cron worker
 * charge les entrées puis appelle cette fonction pour décider quoi supprimer.
 */
export function selectAuditLogsToPurge(
  entries: readonly AuditLogRetentionEntry[],
  now: Date = new Date(),
  retentionDays: number = AUDIT_RETENTION_DAYS,
): string[] {
  const cutoff = computeAuditRetentionCutoff(now, retentionDays);
  return entries.filter((e) => e.createdAt.getTime() < cutoff.getTime()).map((e) => e.id);
}
