// Idempotence granulaire (P69) : aide les processors qui itèrent sur PLUSIEURS
// items (slides TTS, étapes de capture d'écran, leçons d'un cours…) à reprendre
// EXACTEMENT où ils se sont arrêtés après un crash/retry BullMQ, au lieu de
// retraiter tout depuis le début. Le principe :
//   1. on charge un checkpoint (liste des index déjà traités + leur résultat) ;
//   2. on saute les index déjà présents dans le checkpoint (pas de double-
//      traitement, résultat rejoué depuis le checkpoint) ;
//   3. après CHAQUE item traité avec succès, on persiste le checkpoint AVANT de
//      passer au suivant — un crash entre deux items ne perd donc que l'item en
//      cours (jamais traité ni checkpointé), jamais les précédents ;
//   4. une fois tous les items traités, le checkpoint est effacé (best-effort) :
//      la prochaine génération repart propre.
//
// Le stockage du checkpoint est injecté (load/save) : ce module ne dépend pas
// de Mongo, ce qui le rend testable en pur mémoire. L'adaptateur Mongo (via
// GenerationJob.checkpoint) est fourni séparément (mongoCheckpointStore).
import { GenerationJob } from '../shared.js';
import { logger } from '../queues/index.js';

/** Un item déjà traité, avec son résultat (rejoué tel quel en cas de reprise). */
export interface CheckpointEntry<R> {
  index: number;
  result: R;
}

/** Persistance du checkpoint d'un job : clé -> liste des items déjà traités. */
export interface CheckpointStore<R> {
  load(jobId: string): Promise<CheckpointEntry<R>[]>;
  save(jobId: string, entries: CheckpointEntry<R>[]): Promise<void>;
  /** Efface le checkpoint une fois tous les items traités (best-effort). */
  clear(jobId: string): Promise<void>;
}

/**
 * Store en mémoire process — utile pour les tests et comme repli si aucun
 * store durable n'est fourni. NE SURVIT PAS à un crash du worker (à ne jamais
 * utiliser en production pour de la vraie reprise).
 */
export function createMemoryCheckpointStore<R>(): CheckpointStore<R> {
  const state = new Map<string, CheckpointEntry<R>[]>();
  return {
    async load(jobId) {
      return state.get(jobId) ?? [];
    },
    async save(jobId, entries) {
      state.set(jobId, entries);
    },
    async clear(jobId) {
      state.delete(jobId);
    },
  };
}

/**
 * Store durable adossé à GenerationJob.checkpoint (Mixed) : { [jobId]: entries }.
 * `step` identifie le pipeline (ex. QUEUES.tts) pour ne pas mélanger les
 * checkpoints de deux étapes différentes du même cours. `courseId` est la clé
 * GenerationJob habituelle (upsert, comme les autres champs de progression).
 */
export function mongoCheckpointStore<R>(courseId: string, step: string): CheckpointStore<R> {
  return {
    async load(jobId) {
      try {
        const doc = await GenerationJob.findOne({ courseId, step }).select('checkpoint').lean();
        const bag = (doc as { checkpoint?: Record<string, CheckpointEntry<R>[]> } | null)?.checkpoint;
        return bag?.[jobId] ?? [];
      } catch (err) {
        logger.warn({ courseId, step, jobId, err }, 'lecture du checkpoint impossible — reprise depuis zéro');
        return [];
      }
    },
    async save(jobId, entries) {
      try {
        await GenerationJob.updateOne(
          { courseId, step },
          { $set: { [`checkpoint.${jobId}`]: entries } },
          { upsert: true },
        );
      } catch (err) {
        logger.warn({ courseId, step, jobId, err }, 'écriture du checkpoint impossible (best-effort)');
      }
    },
    async clear(jobId) {
      try {
        await GenerationJob.updateOne({ courseId, step }, { $unset: { [`checkpoint.${jobId}`]: '' } });
      } catch (err) {
        logger.warn({ courseId, step, jobId, err }, 'purge du checkpoint impossible (best-effort)');
      }
    },
  };
}

export interface WithCheckpointOptions<S, R> {
  /** Identifiant stable du job (ex. lessonId) : clé du checkpoint. */
  jobId: string;
  /** Items à traiter, dans l'ordre. Reprendre = continuer cette même liste. */
  steps: readonly S[];
  /** Traite un item ; le résultat est checkpointé s'il ne jette pas. */
  runStep: (step: S, index: number) => Promise<R>;
  /** Persistance du checkpoint (mémoire par défaut — voir mongoCheckpointStore). */
  store?: CheckpointStore<R>;
  /** Callback optionnel après chaque item (traité OU rejoué) pour progression. */
  onStep?: (info: { index: number; total: number; result: R; resumed: boolean }) => void | Promise<void>;
}

export interface WithCheckpointResult<R> {
  /** Résultats de TOUS les items (rejoués + nouvellement traités), dans l'ordre. */
  results: R[];
  /** Nombre d'items rejoués depuis le checkpoint (déjà traités avant le crash). */
  resumedCount: number;
  /** Nombre d'items réellement exécutés dans cet appel. */
  processedCount: number;
}

/**
 * Exécute `runStep` sur chaque élément de `steps`, en reprenant depuis le
 * dernier checkpoint connu pour `jobId` : les index déjà présents dans le
 * checkpoint ne sont PAS repassés dans `runStep` (leur résultat sauvegardé est
 * réutilisé tel quel). Après le traitement réussi d'un item, le checkpoint est
 * immédiatement persisté — un crash au milieu de la boucle ne fait donc perdre
 * QUE l'item en cours de traitement, jamais les précédents ni de saut d'item.
 *
 * Ne rattrape PAS les erreurs de `runStep` : elles remontent telles quelles
 * (le job BullMQ échoue et sera retenté — la reprise se fera alors depuis le
 * checkpoint déjà persisté). Une fois tous les items traités avec succès, le
 * checkpoint est effacé (la leçon/l'entité est repassée en régénération
 * complète au prochain déclenchement).
 */
export async function withCheckpoint<S, R>(
  options: WithCheckpointOptions<S, R>,
): Promise<WithCheckpointResult<R>> {
  const { jobId, steps, runStep, onStep } = options;
  const store = options.store ?? createMemoryCheckpointStore<R>();

  const existing = await store.load(jobId);
  const byIndex = new Map(existing.map((e) => [e.index, e.result]));

  const results: R[] = [];
  let resumedCount = 0;
  let processedCount = 0;
  // Copie mutable de la liste persistée : on y ajoute au fil de la boucle.
  const entries: CheckpointEntry<R>[] = [...existing];

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index] as S;

    if (byIndex.has(index)) {
      // Déjà traité avant un crash précédent : on rejoue le résultat sans
      // ré-exécuter runStep (pas de double-traitement, pas d'appel refacturé).
      const result = byIndex.get(index) as R;
      results.push(result);
      resumedCount += 1;
      await onStep?.({ index, total: steps.length, result, resumed: true });
      continue;
    }

    // Item non encore traité : exécution réelle. Toute exception remonte SANS
    // checkpoint (l'item sera retenté depuis le début à la prochaine tentative).
    const result = await runStep(step, index);
    results.push(result);
    processedCount += 1;

    // Persistance IMMÉDIATE avant de passer à l'item suivant : c'est le coeur
    // de la reprise granulaire (P69).
    entries.push({ index, result });
    await store.save(jobId, entries);

    await onStep?.({ index, total: steps.length, result, resumed: false });
  }

  // Tous les items traités : le checkpoint n'a plus d'utilité (best-effort).
  await store.clear(jobId);

  return { results, resumedCount, processedCount };
}
