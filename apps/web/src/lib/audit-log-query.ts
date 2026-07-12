import type { FilterQuery } from 'mongoose';
import type { AuditAction, IAuditLog } from '@sallycourse/db';

/**
 * Filtres/CSV du journal d'audit (Prompt 149) — fonctions PURES, testables
 * sans base. La page admin ("Audit global") et la page utilisateur ("Mon
 * activité") construisent la query Mongo via buildAuditLogFilter puis
 * exécutent la requête elles-mêmes ; l'export CSV réutilise auditLogsToCsv.
 */

export interface AuditLogFilterInput {
  /** Restreint à un utilisateur précis (page "Mon activité" : toujours fourni). */
  userId?: string;
  action?: AuditAction | 'all';
  /** Bornes de date inclusives, au format ISO (yyyy-mm-dd) — vient d'un <input type="date">. */
  from?: string;
  to?: string;
}

/** Construit la query Mongo filtrée à partir des paramètres bruts (déjà validés côté appelant). */
export function buildAuditLogFilter(input: AuditLogFilterInput): FilterQuery<IAuditLog> {
  const filter: FilterQuery<IAuditLog> = {};

  if (input.userId) filter.userId = input.userId;
  if (input.action && input.action !== 'all') filter.action = input.action;

  const createdAt: { $gte?: Date; $lte?: Date } = {};
  if (input.from) {
    const fromDate = new Date(input.from);
    if (!Number.isNaN(fromDate.getTime())) createdAt.$gte = fromDate;
  }
  if (input.to) {
    // Borne haute inclusive : fin de journée.
    const toDate = new Date(input.to);
    if (!Number.isNaN(toDate.getTime())) {
      toDate.setHours(23, 59, 59, 999);
      createdAt.$lte = toDate;
    }
  }
  if (Object.keys(createdAt).length > 0) filter.createdAt = createdAt;

  return filter;
}

/** Ligne minimale nécessaire à l'export/affichage — déjà projetée par l'appelant. */
export interface AuditLogRow {
  id: string;
  userId?: string;
  userEmail?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  ip?: string;
  userAgent?: string;
  createdAt: Date;
}

/** Échappe une valeur pour une cellule CSV (RFC 4180 minimal). */
function csvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Export CSV du journal d'audit — une ligne par entrée, tri du plus récent au plus ancien. */
export function auditLogsToCsv(rows: readonly AuditLogRow[]): string {
  const header = ['date', 'utilisateur', 'action', 'cible_type', 'cible_id', 'ip', 'user_agent'].join(',');
  const lines = rows
    .slice()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((r) =>
      [
        csvCell(r.createdAt.toISOString()),
        csvCell(r.userEmail ?? r.userId ?? ''),
        csvCell(r.action),
        csvCell(r.targetType ?? ''),
        csvCell(r.targetId ?? ''),
        csvCell(r.ip ?? ''),
        csvCell(r.userAgent ?? ''),
      ].join(','),
    );
  return [header, ...lines].join('\n');
}
