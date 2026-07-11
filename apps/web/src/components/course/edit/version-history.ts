/**
 * Logique pure de l'historique des versions d'une leçon (P131) : préparation
 * du snapshot à sauvegarder, diff ligne à ligne simplifié pour un contenu
 * Markdown, et résolution de la valeur à réappliquer lors d'une restauration.
 * Aucune dépendance React/réseau — testable directement.
 */

export interface LessonVersionSummary {
  id: string;
  createdAt: string; // ISO
  label?: string;
}

export type DiffOp = 'equal' | 'add' | 'remove';

export interface DiffLine {
  op: DiffOp;
  text: string;
}

/**
 * Diff texte simple ligne à ligne (LCS) — suffisant pour visualiser les
 * changements entre deux versions Markdown dans l'UI « Historique ». Pas
 * destiné à des fichiers volumineux (complexité O(n*m)).
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length;
  const m = b.length;

  // Table LCS classique.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      result.push({ op: 'equal', text: a[i]! });
      i += 1;
      j += 1;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      result.push({ op: 'remove', text: a[i]! });
      i += 1;
    } else {
      result.push({ op: 'add', text: b[j]! });
      j += 1;
    }
  }
  while (i < n) {
    result.push({ op: 'remove', text: a[i]! });
    i += 1;
  }
  while (j < m) {
    result.push({ op: 'add', text: b[j]! });
    j += 1;
  }
  return result;
}

/**
 * Détermine si une nouvelle version doit être créée avant d'enregistrer une
 * édition : on évite de verser une version pour un changement trivial (même
 * contenu, ou dernière version identique) — une version par édition
 * significative, pas à chaque frappe/debounce.
 */
export function shouldSnapshotBeforeSave(previousContent: unknown, nextContent: unknown): boolean {
  if (previousContent === undefined || previousContent === null) return false;
  return JSON.stringify(previousContent) !== JSON.stringify(nextContent);
}

/**
 * Résout la valeur à réinjecter dans l'éditeur lors d'une restauration de
 * version. Retourne le snapshot tel quel — la fonction existe pour isoler
 * (et pouvoir tester) le point de décision, notamment le rejet d'un
 * identifiant de version absent de la liste connue.
 */
export function resolveRestoreTarget<T>(
  versions: Array<{ id: string; snapshot: T }>,
  versionId: string,
): T | null {
  const found = versions.find((version) => version.id === versionId);
  return found ? found.snapshot : null;
}

/** Tri anté-chronologique (plus récent d'abord) pour l'affichage de la liste. */
export function sortVersionsDesc<T extends LessonVersionSummary>(versions: T[]): T[] {
  return [...versions].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
