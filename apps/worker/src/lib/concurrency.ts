// Retry court sur conflit de version Mongoose (P120). Course a
// `optimisticConcurrency: true` (packages/db/src/models/course.ts) : deux jobs
// qui chargent le même document puis le sauvegardent tour à tour lèvent un
// VersionError sur le second `save()`. Ce helper recharge le document et
// réapplique la mutation métier (fournie par l'appelant) un petit nombre de
// fois avant d'abandonner — le pattern classique "read-modify-write with retry"
// pour les champs indépendants (refreshSuggestions, improvementSuggestions,
// dubbedVersions, status…) où la dernière écriture peut simplement rejouer sa
// mutation sur l'état frais sans perdre l'intention métier.
import { logger } from '../queues/index.js';

/** Nom Mongoose de l'erreur de conflit de version (VersionError). */
const VERSION_ERROR_NAME = 'VersionError';

/** Vrai si `err` est un conflit de version optimiste Mongoose. */
export function isVersionError(err: unknown): boolean {
  return err instanceof Error && err.name === VERSION_ERROR_NAME;
}

export interface RetryOnVersionConflictOptions {
  /** Nombre de tentatives supplémentaires après l'échec initial (défaut 3). */
  retries?: number;
  /** Étiquette de contexte pour les logs (ex. courseId). */
  context?: Record<string, unknown>;
}

/**
 * Exécute `fn` (charge le document, applique une mutation, sauvegarde) et
 * retente jusqu'à `retries` fois si `fn` échoue avec un VersionError. Toute
 * autre erreur remonte immédiatement, sans retry. Épuisement des tentatives →
 * la dernière erreur (VersionError) remonte à l'appelant.
 */
export async function retryOnVersionConflict<T>(
  fn: () => Promise<T>,
  options: RetryOnVersionConflictOptions = {},
): Promise<T> {
  const retries = options.retries ?? 3;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isVersionError(err)) throw err;
      logger.warn(
        { ...options.context, attempt: attempt + 1, retries },
        'conflit de version optimiste (VersionError) — nouvelle tentative',
      );
    }
  }

  throw lastErr;
}

/** Document Mongoose minimal manipulé par `saveFieldWithRetry`. */
export interface SavableDocument {
  save: () => Promise<unknown>;
}

/**
 * Recharge puis sauvegarde un document via `reload`, en appliquant `mutate` à
 * CHAQUE tentative (y compris la première, sur le document déjà chargé par
 * l'appelant) — un VersionError sur `save()` déclenche un rechargement frais
 * avant de réappliquer `mutate` et retenter. Adapté aux champs indépendants
 * (Course.refreshSuggestions, .improvementSuggestions, .dubbedVersions…) où la
 * dernière écriture peut rejouer sa mutation sans conflit sémantique avec les
 * autres jobs concurrents (qui touchent d'autres champs).
 */
export async function saveFieldWithRetry<D extends SavableDocument>(
  initial: D,
  reload: () => Promise<D | null>,
  mutate: (doc: D) => void,
  options: RetryOnVersionConflictOptions = {},
): Promise<D | null> {
  const retries = options.retries ?? 3;
  let doc: D | null = initial;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (!doc) return null;
    try {
      mutate(doc);
      await doc.save();
      return doc;
    } catch (err) {
      lastErr = err;
      if (!isVersionError(err)) throw err;
      logger.warn(
        { ...options.context, attempt: attempt + 1, retries },
        'conflit de version optimiste (VersionError) — rechargement et nouvelle tentative',
      );
      doc = await reload();
    }
  }

  throw lastErr;
}
