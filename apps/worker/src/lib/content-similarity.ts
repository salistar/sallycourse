// Déduplication du contenu GÉNÉRÉ (Prompt 115) : détecte les leçons/cours quasi
// identiques produits par les générateurs LLM (pas une comparaison de code).
//
// Approche : APPROXIMATION LOCALE GRATUITE — pas d'appel à une API d'embeddings
// (coûteux, réseau). On utilise un indice de Jaccard sur des shingles (n-grams
// de mots consécutifs, taille CONTENT_SIMILARITY.NGRAM_SIZE) : chaque texte est
// réduit à l'ensemble de ses n-grams normalisés, puis on mesure le recouvrement
// |A ∩ B| / |A ∪ B|. C'est un fingerprint déterministe, sans dépendance externe,
// suffisant pour détecter des paraphrases proches ou du contenu dupliqué mot
// pour mot. Une vraie API d'embeddings sémantiques (ex. Claude/OpenAI embeddings)
// capturerait mieux les reformulations profondes et pourrait remplacer ce module
// plus tard sans changer sa signature (compareSimilarity → score 0-1).
import { CONTENT_SIMILARITY, type ILesson, type SlideScript, type TpContent } from '../shared.js';

/** Normalise un texte pour le shingling : minuscules, ponctuation retirée, espaces compactés. */
function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // accents
    .replace(/```[\s\S]*?```/g, ' ') // blocs de code fencés exclus (bruit, pas du contenu pédagogique comparable)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Fingerprint d'un texte : ensemble (Set) des n-grams de mots consécutifs,
 * taille `n` (défaut CONTENT_SIMILARITY.NGRAM_SIZE). Déterministe et local —
 * aucun appel réseau. Retourne un Set vide si le texte a moins de `n` mots.
 */
export function hashSimilarityFingerprint(
  text: string,
  n: number = CONTENT_SIMILARITY.NGRAM_SIZE,
): Set<string> {
  const words = normalizeWords(text ?? '');
  if (words.length < n) return new Set(words.length ? [words.join(' ')] : []);
  const shingles = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) {
    shingles.add(words.slice(i, i + n).join(' '));
  }
  return shingles;
}

/**
 * Score de similarité 0-1 entre deux textes, via l'indice de Jaccard sur leurs
 * fingerprints de n-grams (hashSimilarityFingerprint). 1 = textes identiques
 * (ou tous deux vides), 0 = aucun n-gram en commun. Pur et déterministe.
 */
export function compareSimilarity(textA: string, textB: string): number {
  const a = hashSimilarityFingerprint(textA);
  const b = hashSimilarityFingerprint(textB);
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const shingle of a) {
    if (b.has(shingle)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

/** true si le score dépasse le seuil d'alerte (CONTENT_SIMILARITY.WARNING_THRESHOLD). */
export function isSimilarityWarning(score: number): boolean {
  return score >= CONTENT_SIMILARITY.WARNING_THRESHOLD;
}

/**
 * Extrait le texte RÉELLEMENT généré d'une leçon, comparable entre deux
 * leçons du même cours — narration vidéo, énoncé de TP, ou article Markdown
 * (assets.articleMd, sans les blocs de code). Repli sur le résumé d'outline
 * si aucun contenu généré n'est encore disponible (leçon pas encore prête).
 */
export function extractComparableLessonText(
  lesson: Pick<ILesson, 'type' | 'title' | 'summary' | 'script' | 'assets'>,
): string {
  if (lesson.type === 'video' && lesson.script) {
    const script = lesson.script as Partial<SlideScript>;
    const narrations = (script.slides ?? [])
      .map((s) => s?.narration ?? '')
      .filter(Boolean)
      .join(' ');
    if (narrations) return narrations;
  }
  if (lesson.type === 'tp' && lesson.script) {
    const tp = lesson.script as Partial<TpContent>;
    const parts = [tp.objective ?? '', ...(tp.steps ?? []).map((s) => s?.instruction ?? '')];
    const joined = parts.filter(Boolean).join(' ');
    if (joined) return joined;
  }
  if (lesson.type === 'article' && lesson.assets?.articleMd) {
    return lesson.assets.articleMd;
  }
  // Quiz ou repli : le résumé d'outline reste le meilleur texte disponible.
  return lesson.summary ?? lesson.title;
}

/** Comparaison de similarité entre une leçon candidate et une leçon déjà générée. */
export interface LessonSimilarityMatch {
  lessonId: string;
  score: number;
}

/**
 * Compare `candidate` à chaque leçon de `others` (texte réellement généré) et
 * retourne la MEILLEURE correspondance si son score dépasse le seuil d'alerte,
 * sinon `undefined`. Pure, ne touche pas la base — l'appelant décide de la
 * persistance (Lesson.similarityWarning) et du logging (GenerationJob.logs).
 */
export function findMostSimilarLesson(
  candidate: Pick<ILesson, 'type' | 'title' | 'summary' | 'script' | 'assets'>,
  others: Array<{ id: string; lesson: Pick<ILesson, 'type' | 'title' | 'summary' | 'script' | 'assets'> }>,
): LessonSimilarityMatch | undefined {
  const candidateText = extractComparableLessonText(candidate);
  let best: LessonSimilarityMatch | undefined;
  for (const other of others) {
    const score = compareSimilarity(candidateText, extractComparableLessonText(other.lesson));
    if (isSimilarityWarning(score) && (!best || score > best.score)) {
      best = { lessonId: other.id, score };
    }
  }
  return best;
}
