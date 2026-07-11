// Similarité de TITRES de cours (P115) — miroir léger de l'algorithme Jaccard
// sur n-grams de apps/worker/src/lib/content-similarity.ts (le web n'importe
// pas le worker, rootDir distinct — voir apps/web/src/components/analytics/
// ab-testing.ts pour le même pattern de miroir). Sert uniquement à
// l'avertissement UI « un cours très similaire existe déjà » à la création,
// jamais un blocage. CONTENT_SIMILARITY (seuil + taille n-gram) reste la
// source de vérité, importée depuis @sallycourse/shared.
import { CONTENT_SIMILARITY } from '@sallycourse/shared';

/** Normalise un texte pour le shingling : minuscules, ponctuation retirée, espaces compactés. */
function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Fingerprint (Set de n-grams de mots) d'un texte — voir hashSimilarityFingerprint côté worker. */
function fingerprint(text: string, n: number = CONTENT_SIMILARITY.NGRAM_SIZE): Set<string> {
  const words = normalizeWords(text ?? '');
  if (words.length < n) return new Set(words.length ? [words.join(' ')] : []);
  const shingles = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) {
    shingles.add(words.slice(i, i + n).join(' '));
  }
  return shingles;
}

/** Score de similarité 0-1 (Jaccard sur n-grams) entre deux titres. */
export function compareTitleSimilarity(titleA: string, titleB: string): number {
  const a = fingerprint(titleA);
  const b = fingerprint(titleB);
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const shingle of a) if (b.has(shingle)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

/** Titre existant le plus proche parmi `existingTitles`, si au-dessus du seuil d'alerte. */
export function findMostSimilarTitle(
  candidateTitle: string,
  existingTitles: readonly string[],
): { title: string; score: number } | undefined {
  let best: { title: string; score: number } | undefined;
  for (const title of existingTitles) {
    const score = compareTitleSimilarity(candidateTitle, title);
    if (score >= CONTENT_SIMILARITY.WARNING_THRESHOLD && (!best || score > best.score)) {
      best = { title, score };
    }
  }
  return best;
}
