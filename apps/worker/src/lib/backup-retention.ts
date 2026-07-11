// Logique PURE de sauvegarde Mongo (P74) : nommage horodaté des dumps +
// politique de rétention (30 jours par défaut). Aucune I/O ici — les scripts
// shell/Node (scripts/backup-mongo.sh, scripts/backup-upload.mjs,
// scripts/restore-mongo.sh) appellent ces fonctions ou en réimplémentent la
// même logique côté bash ; ce fichier est la source de vérité testée.

/** Nombre de jours de rétention par défaut avant suppression d'un backup. */
export const DEFAULT_RETENTION_DAYS = 30;

/** Préfixe commun à tous les noms de dossiers/archives de backup. */
export const BACKUP_NAME_PREFIX = 'sallycourse-mongo';

/**
 * Construit le nom horodaté d'un backup à partir d'une date UTC, au format
 * `sallycourse-mongo-AAAAMMJJ-HHmmss` (triable lexicographiquement = triable
 * chronologiquement, pas d'ambiguïté de fuseau horaire).
 */
export function formatBackupName(date: Date, prefix: string = BACKUP_NAME_PREFIX): string {
  const yyyy = date.getUTCFullYear().toString().padStart(4, '0');
  const mm = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = date.getUTCDate().toString().padStart(2, '0');
  const hh = date.getUTCHours().toString().padStart(2, '0');
  const min = date.getUTCMinutes().toString().padStart(2, '0');
  const ss = date.getUTCSeconds().toString().padStart(2, '0');
  return `${prefix}-${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

/** Regex du nom généré par formatBackupName (utilisée pour parser/filtrer une liste de noms). */
export function backupNamePattern(prefix: string = BACKUP_NAME_PREFIX): RegExp {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}-(\\d{4})(\\d{2})(\\d{2})-(\\d{2})(\\d{2})(\\d{2})$`);
}

/**
 * Extrait la date UTC encodée dans un nom de backup, ou null si le nom ne
 * correspond pas au motif attendu (fichier étranger dans le même dossier).
 */
export function parseBackupDate(name: string, prefix: string = BACKUP_NAME_PREFIX): Date | null {
  const match = backupNamePattern(prefix).exec(name);
  if (!match) return null;
  const [, yyyy, mm, dd, hh, min, ss] = match;
  const date = new Date(
    Date.UTC(
      Number(yyyy),
      Number(mm) - 1,
      Number(dd),
      Number(hh),
      Number(min),
      Number(ss),
    ),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

export interface BackupEntry {
  /** Nom du dossier/fichier de backup (ex. sallycourse-mongo-20260711-030000). */
  name: string;
}

export interface RetentionResult<T extends BackupEntry> {
  /** Backups à conserver (plus récents que la limite de rétention). */
  keep: T[];
  /** Backups à supprimer (plus anciens que la limite, ou nom non parsable — voir `unparsable`). */
  remove: T[];
  /** Entrées dont le nom ne correspond pas au motif attendu — ignorées, jamais supprimées automatiquement. */
  unparsable: T[];
}

/**
 * Applique la politique de rétention : tout backup dont la date encodée dans
 * le nom est strictement antérieure à `now - retentionDays` est classé en
 * suppression. Les noms qu'on ne sait pas parser sont mis de côté
 * (`unparsable`) et jamais supprimés automatiquement — on préfère un backup
 * orphelin en trop qu'une suppression accidentelle d'un fichier inattendu.
 */
export function applyRetentionPolicy<T extends BackupEntry>(
  entries: readonly T[],
  now: Date,
  retentionDays: number = DEFAULT_RETENTION_DAYS,
  prefix: string = BACKUP_NAME_PREFIX,
): RetentionResult<T> {
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;

  const keep: T[] = [];
  const remove: T[] = [];
  const unparsable: T[] = [];

  for (const entry of entries) {
    const date = parseBackupDate(entry.name, prefix);
    if (date === null) {
      unparsable.push(entry);
      continue;
    }
    if (date.getTime() < cutoff) {
      remove.push(entry);
    } else {
      keep.push(entry);
    }
  }

  return { keep, remove, unparsable };
}
