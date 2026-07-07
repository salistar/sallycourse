// Logique de reprise PURE (testable hors DB) : détermine quelles leçons
// uploader à partir d'un checkpoint et exécute la boucle en avançant le
// checkpoint après CHAQUE succès. Le processor s'appuie sur la même règle
// (les leçons d'index < lessonIndex sont considérées déjà uploadées).

import type { DeployCheckpoint } from './types.js';

/** Indices (0-based) restant à uploader compte tenu du checkpoint. */
export function pendingLessonIndices(total: number, checkpoint: DeployCheckpoint): number[] {
  const start = Math.max(0, Math.min(checkpoint.lessonIndex, total));
  const out: number[] = [];
  for (let i = start; i < total; i += 1) out.push(i);
  return out;
}

/**
 * Exécute l'upload des leçons restantes en respectant le checkpoint. Après
 * chaque upload réussi, `advance(index+1)` est appelé pour persister le point
 * de reprise ; une erreur d'upload interrompt la boucle SANS avancer (l'index
 * échoué sera réessayé à la reprise). Retourne le nombre de leçons uploadées.
 */
export async function runResumableUploads(
  total: number,
  checkpoint: DeployCheckpoint,
  upload: (index: number) => Promise<void>,
  advance: (nextLessonIndex: number) => Promise<void>,
): Promise<number> {
  let uploaded = 0;
  for (const index of pendingLessonIndices(total, checkpoint)) {
    await upload(index);
    uploaded += 1;
    await advance(index + 1);
  }
  return uploaded;
}
