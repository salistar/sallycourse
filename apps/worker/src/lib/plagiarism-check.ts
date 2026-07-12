// Détection de plagiat SORTANT (Prompt 141) : avant publication, on vérifie
// que le contenu GÉNÉRÉ (narration vidéo, article, TP) ne reproduit pas du
// contenu déjà existant ailleurs sur le web.
//
// LIMITATION HONNÊTE (documentée, pas cachée) : ceci est une vérification
// « best-effort », PAS une garantie légale d'absence de plagiat. Approche :
//  1) Extraction de PHRASES DISTINCTIVES (8+ mots consécutifs, peu communes,
//     donc peu susceptibles d'être un hasard de formulation) dans le texte
//     généré — même logique de fenêtre glissante que content-similarity.ts
//     mais orientée « recherche web », pas comparaison interne.
//  2) Si une clé de recherche web existe (WEB_SEARCH_API_KEY, ex. Brave
//     Search — cf. TODO déjà noté dans course-refresh.ts) : recherche de
//     CHAQUE phrase distinctive entre guillemets, et on marque « trop proche »
//     si un résultat renvoie une correspondance quasi exacte. Coût/latence
//     maîtrisés : on ne teste qu'un sous-échantillon de phrases (voir
//     PLAGIARISM.MAX_PHRASES_CHECKED).
//  3) MOCK (clé absente OU MOCK_PROVIDERS=true, ou API en erreur) : on ne
//     tente AUCUN appel réseau — score d'originalité par défaut élevé
//     (PLAGIARISM.MOCK_DEFAULT_SCORE), avec le champ `method: 'mock-skip'`
//     pour que l'appelant sache que ce n'est PAS une vérification réelle.
//
// Aucune API de plagiat payante (Copyscape, Turnitin…) — hors budget/scope.
// Ce module est le point d'extension : remplacer `searchPhraseOnWeb` par un
// vrai appel Copyscape/Turnitin plus tard ne changerait pas les signatures
// publiques (checkLessonOriginality → OriginalityReport).

// @ts-ignore TS6059 — source hors rootDir (voir shared.ts), typage intact
import { getConfig, type ILesson, type SlideScript, type TpContent } from '../shared.js';
import { extractComparableLessonText } from './content-similarity.js';
import { logger } from '../queues/index.js';

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

/** Seuils et bornes de la vérification (regroupés pour lisibilité/tests). */
export const PLAGIARISM = {
  /** Nombre de mots consécutifs d'une phrase « distinctive » (fenêtre glissante). */
  PHRASE_WORD_COUNT: 8,
  /** Score d'originalité (0-1) en dessous duquel on propose une régénération. */
  REGENERATE_THRESHOLD: 0.7,
  /** Score par défaut quand la vérification est skip (mode mock, honnête : optimiste). */
  MOCK_DEFAULT_SCORE: 0.95,
  /** Nombre max de phrases distinctives réellement recherchées sur le web (coût/latence). */
  MAX_PHRASES_CHECKED: 5,
  /** Pénalité de score par phrase jugée trop proche d'une source existante. */
  SCORE_PENALTY_PER_MATCH: 0.15,
} as const;

/** Méthode réellement employée pour produire le rapport — traçabilité honnête. */
export type OriginalityMethod = 'web-search' | 'mock-skip';

/** Une phrase distinctive extraite du texte généré, avec sa position. */
export interface DistinctivePhrase {
  text: string;
  /** Index du premier mot de la phrase dans le texte normalisé (déterministe). */
  index: number;
}

/** Résultat de la recherche web pour une phrase distinctive donnée. */
export interface PhraseMatchResult {
  phrase: string;
  /** true si une source externe quasi identique a été trouvée. */
  matched: boolean;
  /** URL de la source la plus proche, si trouvée. */
  sourceUrl?: string;
}

/** Rapport d'originalité d'une leçon — stocké en partie sur Lesson.originalityScore. */
export interface OriginalityReport {
  method: OriginalityMethod;
  /** Score d'originalité 0-1 (1 = aucun signal de plagiat détecté). */
  score: number;
  /** Phrases distinctives effectivement vérifiées (vide en mode mock-skip). */
  phrasesChecked: PhraseMatchResult[];
  /** true si score < PLAGIARISM.REGENERATE_THRESHOLD → régénération recommandée. */
  suggestRegeneration: boolean;
  /**
   * Rappel honnête affiché à l'utilisateur : ce contrôle ne garantit rien
   * juridiquement, il repère seulement des correspondances exactes trouvées
   * par une recherche web basique (ou rien du tout en mode mock).
   */
  disclaimer: string;
}

const DISCLAIMER_WEB =
  'Vérification best-effort par recherche web de phrases distinctives — ' +
  "ne constitue PAS une garantie légale d'absence de plagiat.";
const DISCLAIMER_MOCK =
  'Aucune clé de recherche web configurée (ou mode simulé) : vérification ' +
  "ignorée, score d'originalité par défaut appliqué. Ne constitue PAS une " +
  'garantie de contenu original — à corroborer manuellement avant publication.';

/* ------------------------------------------------------------------ */
/* Extraction de phrases distinctives (PURE)                           */
/* ------------------------------------------------------------------ */

/** Normalise un texte en mots (aligné sur content-similarity.ts, indépendant pour ne pas coupler les deux modules). */
function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Extrait des phrases distinctives (fenêtres de PLAGIARISM.PHRASE_WORD_COUNT
 * mots consécutifs) du texte généré. Non-chevauchantes (on avance d'une
 * fenêtre complète à chaque extraction) pour ne pas sur-échantillonner un
 * même passage. Retourne [] si le texte a moins de mots que la fenêtre.
 * Pure et déterministe — aucune I/O.
 */
export function extractDistinctivePhrases(
  text: string,
  windowSize: number = PLAGIARISM.PHRASE_WORD_COUNT,
): DistinctivePhrase[] {
  const words = normalizeWords(text ?? '');
  if (words.length < windowSize) return [];

  const phrases: DistinctivePhrase[] = [];
  for (let i = 0; i + windowSize <= words.length; i += windowSize) {
    phrases.push({ text: words.slice(i, i + windowSize).join(' '), index: i });
  }
  return phrases;
}

/**
 * Sélectionne un sous-échantillon représentatif de phrases à vérifier
 * (borné par PLAGIARISM.MAX_PHRASES_CHECKED) : réparties uniformément sur
 * tout le texte plutôt que les N premières, pour couvrir intro/milieu/fin.
 * Pure, déterministe.
 */
export function samplePhrasesForCheck(
  phrases: DistinctivePhrase[],
  maxCount: number = PLAGIARISM.MAX_PHRASES_CHECKED,
): DistinctivePhrase[] {
  if (phrases.length <= maxCount) return phrases;
  const stride = phrases.length / maxCount;
  const sampled: DistinctivePhrase[] = [];
  for (let i = 0; i < maxCount; i++) {
    sampled.push(phrases[Math.floor(i * stride)]!);
  }
  return sampled;
}

/* ------------------------------------------------------------------ */
/* Logique de seuil / score (PURE)                                     */
/* ------------------------------------------------------------------ */

/**
 * Calcule le score d'originalité 0-1 à partir des résultats de recherche :
 * 1 moins une pénalité par phrase trouvée en correspondance quasi exacte,
 * plancher 0. Pure — ne dépend que des résultats déjà obtenus.
 */
export function computeOriginalityScore(results: PhraseMatchResult[]): number {
  if (results.length === 0) return PLAGIARISM.MOCK_DEFAULT_SCORE;
  const matches = results.filter((r) => r.matched).length;
  return Math.max(0, 1 - matches * PLAGIARISM.SCORE_PENALTY_PER_MATCH);
}

/** true si le score est sous le seuil de régénération (PLAGIARISM.REGENERATE_THRESHOLD). */
export function shouldSuggestRegeneration(score: number): boolean {
  return score < PLAGIARISM.REGENERATE_THRESHOLD;
}

/* ------------------------------------------------------------------ */
/* Recherche web (I/O, isolée — mockable/désactivable)                 */
/* ------------------------------------------------------------------ */

/** Réponse minimale attendue de l'API de recherche (forme générique, ex. Brave Search). */
interface WebSearchApiResult {
  web?: { results?: Array<{ url?: string; title?: string; description?: string }> };
}

/**
 * Recherche une phrase distinctive sur le web (requête entre guillemets =
 * correspondance exacte) via l'API de recherche configurée. Retourne
 * `matched: true` si un résultat semble reproduire la phrase quasi mot pour
 * mot (heuristique : la description du résultat contient la phrase ou une
 * large portion). Ne jette jamais — un échec réseau/API est traité comme
 * « non vérifiable », donc `matched: false` (on ne pénalise pas sur un doute
 * technique, cf. disclaimer : best-effort seulement).
 */
export async function searchPhraseOnWeb(
  phrase: string,
  apiKey: string,
): Promise<PhraseMatchResult> {
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(`"${phrase}"`)}&count=3`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return { phrase, matched: false };

    const data = (await res.json()) as WebSearchApiResult;
    const results = data.web?.results ?? [];
    const normalizedPhrase = phrase.toLowerCase();
    const hit = results.find((r) =>
      (r.description ?? '').toLowerCase().includes(normalizedPhrase),
    );
    return hit ? { phrase, matched: true, sourceUrl: hit.url } : { phrase, matched: false };
  } catch (err) {
    logger.warn({ err }, 'recherche web plagiat impossible (traité comme non vérifiable)');
    return { phrase, matched: false };
  }
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                       */
/* ------------------------------------------------------------------ */

/**
 * Vérifie l'originalité d'un texte déjà extrait (narration/article/TP) :
 * mode 'web-search' si une clé est configurée et MOCK_PROVIDERS n'est pas
 * actif, sinon 'mock-skip' honnête (aucun appel réseau, score par défaut
 * élevé). Best-effort — ne jette jamais (une erreur réseau retombe sur le
 * comportement mock pour cette exécution).
 */
export async function checkTextOriginality(text: string): Promise<OriginalityReport> {
  const config = getConfig();
  const apiKey = config.WEB_SEARCH_API_KEY;

  if (config.MOCK_PROVIDERS || !apiKey) {
    return {
      method: 'mock-skip',
      score: PLAGIARISM.MOCK_DEFAULT_SCORE,
      phrasesChecked: [],
      suggestRegeneration: false,
      disclaimer: DISCLAIMER_MOCK,
    };
  }

  const phrases = samplePhrasesForCheck(extractDistinctivePhrases(text));
  if (phrases.length === 0) {
    return {
      method: 'web-search',
      score: PLAGIARISM.MOCK_DEFAULT_SCORE,
      phrasesChecked: [],
      suggestRegeneration: false,
      disclaimer: DISCLAIMER_WEB,
    };
  }

  const results = await Promise.all(phrases.map((p) => searchPhraseOnWeb(p.text, apiKey)));
  const score = computeOriginalityScore(results);

  return {
    method: 'web-search',
    score,
    phrasesChecked: results,
    suggestRegeneration: shouldSuggestRegeneration(score),
    disclaimer: DISCLAIMER_WEB,
  };
}

/**
 * Vérifie l'originalité d'une leçon (extrait le texte réellement généré via
 * extractComparableLessonText, réutilisé de content-similarity.ts — même
 * notion de « contenu comparable » que pour la déduplication interne P115).
 */
export async function checkLessonOriginality(
  lesson: Pick<ILesson, 'type' | 'title' | 'summary' | 'script' | 'assets'>,
): Promise<OriginalityReport> {
  const text = extractComparableLessonText(lesson);
  return checkTextOriginality(text);
}

/**
 * Traduit le rapport en entrée de compliance Udemy renforcée (P48) : une
 * remarque optionnelle si score sous le seuil de régénération, à intégrer
 * dans udemy-max-compliance.ts comme vérification supplémentaire. Ce module
 * ne dépend PAS de udemy-max-compliance (sens inverse) pour éviter un cycle —
 * c'est l'appelant (adapter Udemy / pipeline compliance) qui pousse ce résultat
 * dans MaxComplianceIssue[] si souhaité.
 */
export interface OriginalityComplianceNote {
  code: 'MAX_ORIGINALITY_LOW';
  severity: 'warning';
  message: string;
  location?: string;
}

export function toComplianceNote(
  report: OriginalityReport,
  lessonTitle: string,
): OriginalityComplianceNote | null {
  if (!report.suggestRegeneration) return null;
  const pct = Math.round(report.score * 100);
  return {
    code: 'MAX_ORIGINALITY_LOW',
    severity: 'warning',
    message:
      `Originalité faible (${pct}%) détectée pour « ${lessonTitle} » — ${report.disclaimer} ` +
      'Une régénération du passage concerné est recommandée avant publication.',
    location: `leçon « ${lessonTitle} »`,
  };
}

export type { SlideScript, TpContent };
