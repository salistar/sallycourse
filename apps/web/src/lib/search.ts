/**
 * Recherche globale (P132) — full-text simple via l'index texte MongoDB
 * natif ($text) sur Course/Section/Lesson. Pas d'Elasticsearch/Meilisearch
 * avant Phase 9 OSS (voir packages/db/src/models/{course,section,lesson}.ts
 * pour les index texte). Ce module regroupe la logique PURE (construction de
 * requête + surlignage), testable sans MongoDB.
 */

/** Longueur minimale du terme recherché (évite les scans $text quasi vides). */
export const SEARCH_MIN_QUERY_LENGTH = 2;

/** Nombre max de résultats retournés par collection. */
export const SEARCH_LIMIT_PER_COLLECTION = 8;

/**
 * Nettoie le terme de recherche utilisateur avant de le passer à $text :
 * - trim + collapse des espaces
 * - échappe les guillemets doubles (le driver Mongo interprète `"phrase"`
 *   comme une recherche de phrase exacte dans $text — on neutralise pour
 *   éviter qu'un guillemet non fermé ne casse la requête)
 */
export function sanitizeSearchQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').replace(/"/g, '');
}

/** Résultat de validation d'une requête de recherche entrante. */
export interface SearchQueryValidation {
  valid: boolean;
  query: string;
  reason?: string;
}

/** Valide + nettoie une requête brute (query string ?q=...). */
export function validateSearchQuery(raw: string | null | undefined): SearchQueryValidation {
  const query = sanitizeSearchQuery(raw ?? '');
  if (query.length < SEARCH_MIN_QUERY_LENGTH) {
    return { valid: false, query, reason: 'Requête trop courte.' };
  }
  return { valid: true, query };
}

/**
 * Construit le filtre Mongo `$text` scopé à l'utilisateur courant, avec
 * projection du score de pertinence. Fonction pure (pas d'accès DB) — le
 * `extraMatch` permet d'ajouter des contraintes additionnelles (ex: userId
 * indirect via courseId $in pour Section/Lesson).
 */
export interface TextSearchQuery {
  filter: Record<string, unknown>;
  projection: Record<string, unknown>;
  /** Tri par score de pertinence $text — forme attendue par Mongoose .sort(). */
  sort: { score: { $meta: 'textScore' } };
  limit: number;
}

export function buildTextSearchQuery(
  query: string,
  extraMatch: Record<string, unknown> = {},
  limit: number = SEARCH_LIMIT_PER_COLLECTION,
): TextSearchQuery {
  return {
    filter: { ...extraMatch, $text: { $search: query } },
    projection: { score: { $meta: 'textScore' } },
    sort: { score: { $meta: 'textScore' } },
    limit,
  };
}

/** Un extrait de texte avec le terme recherché marqué pour surlignage. */
export interface HighlightSegment {
  text: string;
  match: boolean;
}

/**
 * Découpe `text` en segments {text, match} autour des occurrences
 * (insensibles à la casse et aux accents) du terme recherché — sert au
 * surlignage côté client (composant SearchModal). Fonction pure.
 */
export function highlightMatches(text: string, query: string): HighlightSegment[] {
  const trimmedQuery = query.trim();
  if (!trimmedQuery || !text) return [{ text, match: false }];

  const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const normalizedText = normalize(text);
  const normalizedQuery = normalize(trimmedQuery);

  if (!normalizedQuery) return [{ text, match: false }];

  const segments: HighlightSegment[] = [];
  let cursor = 0;
  let searchFrom = 0;

  while (searchFrom <= normalizedText.length) {
    const idx = normalizedText.indexOf(normalizedQuery, searchFrom);
    if (idx === -1) break;
    if (idx > cursor) segments.push({ text: text.slice(cursor, idx), match: false });
    segments.push({ text: text.slice(idx, idx + trimmedQuery.length), match: true });
    cursor = idx + trimmedQuery.length;
    searchFrom = cursor;
  }

  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  if (segments.length === 0) return [{ text, match: false }];
  return segments;
}

/** Extrait un court passage autour de la première occurrence (pour aperçu de résultat). */
export function excerptAroundMatch(text: string, query: string, radius = 60): string {
  const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const normalizedText = normalize(text);
  const normalizedQuery = normalize(query.trim());
  if (!normalizedQuery) return text.slice(0, radius * 2);

  const idx = normalizedText.indexOf(normalizedQuery);
  if (idx === -1) return text.slice(0, radius * 2);

  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + normalizedQuery.length + radius);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

/* ------------------------------------------------------------------ */
/* Types de résultat groupés par cours (contrat API /api/search)       */
/* ------------------------------------------------------------------ */

export type SearchResultKind = 'course' | 'section' | 'lesson';

export interface SearchResultItem {
  kind: SearchResultKind;
  id: string;
  title: string;
  /** Extrait avec contexte autour du terme trouvé (résumé pour lesson). */
  excerpt?: string;
  score: number;
  /** Lien direct vers la ressource trouvée. */
  href: string;
}

export interface SearchResultGroup {
  courseId: string;
  courseTitle: string;
  items: SearchResultItem[];
}

/** Regroupe une liste plate de résultats par cours, triés par score décroissant au sein d'un groupe. */
export function groupResultsByCourse(
  items: Array<SearchResultItem & { courseId: string; courseTitle: string }>,
): SearchResultGroup[] {
  const groups = new Map<string, SearchResultGroup>();
  for (const item of items) {
    const existing = groups.get(item.courseId);
    const { courseId, courseTitle, ...rest } = item;
    if (existing) {
      existing.items.push(rest);
    } else {
      groups.set(courseId, { courseId, courseTitle, items: [rest] });
    }
  }
  for (const group of groups.values()) {
    group.items.sort((a, b) => b.score - a.score);
  }
  return Array.from(groups.values());
}
