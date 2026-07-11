// Statistiques du cache intelligent (Prompt 72) — fonctions PURES d'agrégation
// pour le dashboard admin. Les compteurs bruts (hits/misses par namespace)
// sont lus depuis Redis par read-cache-stats.ts (côté serveur, non testé ici) ;
// ce module ne fait que dériver taux de hit et économie estimée, ré-estimée
// depuis la table de tarifs partagée — cohérent avec cost-stats.ts (P55).
import {
  CLAUDE_PRICING_USD_PER_MTOK,
  TTS_USD_PER_CHAR,
  RENDER_USD_PER_SECOND,
  type CostKind,
} from '@sallycourse/shared';

/** Les trois espaces de cache suivis (miroir de CacheNamespace côté worker). */
export type CacheNamespace = 'claude' | 'tts' | 'screenshot';

/** Compteurs bruts lus depuis Redis pour un namespace. */
export interface CacheNamespaceCounts {
  namespace: CacheNamespace;
  hits: number;
  misses: number;
}

/** Ligne dérivée affichée dans le dashboard : taux de hit + économie estimée. */
export interface CacheNamespaceStat {
  namespace: CacheNamespace;
  hits: number;
  misses: number;
  total: number;
  /** Taux de hit, entre 0 et 1 (0 si aucun accès). */
  hitRate: number;
  /** Coût moyen évité par hit, en USD — voir AVG_SAVED_USD_PER_HIT. */
  avgSavedUsd: number;
  /** Économie totale estimée = hits × coût moyen, en USD. */
  estimatedSavingsUsd: number;
}

/**
 * Coût moyen évité par hit, par namespace — ordre de grandeur, pas une mesure
 * exacte (le coût réel varie par appel). Dérivé de la table de tarifs partagée
 * avec une taille d'appel « typique » du pipeline de génération :
 *  - claude   : ~1 500 tokens in + ~2 000 tokens out (prompt système + JSON de
 *               sortie d'un générateur), au tarif claude-sonnet-5 (modèle par
 *               défaut du pipeline).
 *  - tts      : narration de slide typique ≈ 350 caractères.
 *  - screenshot : pas de coût externe facturé (Playwright + sharp, compute
 *               local) — on valorise le temps de calcul évité comme un rendu
 *               vidéo de quelques secondes (ordre de grandeur, RENDER_USD_PER_SECOND).
 */
const TYPICAL_CLAUDE_TOKENS_IN = 1500;
const TYPICAL_CLAUDE_TOKENS_OUT = 2000;
const TYPICAL_TTS_CHARS = 350;
/** Durée compute évitée par capture réutilisée (navigation + rendu + annotation). */
const TYPICAL_SCREENSHOT_COMPUTE_SECONDS = 8;

function avgClaudeCostUsd(): number {
  const price = CLAUDE_PRICING_USD_PER_MTOK['claude-sonnet-5']!;
  return (TYPICAL_CLAUDE_TOKENS_IN * price.input + TYPICAL_CLAUDE_TOKENS_OUT * price.output) / 1_000_000;
}

function avgTtsCostUsd(): number {
  return TYPICAL_TTS_CHARS * TTS_USD_PER_CHAR;
}

function avgScreenshotCostUsd(): number {
  return TYPICAL_SCREENSHOT_COMPUTE_SECONDS * RENDER_USD_PER_SECOND;
}

/** Coût moyen évité par hit, par namespace (USD). Exporté pour les tests. */
export function avgSavedUsd(namespace: CacheNamespace): number {
  switch (namespace) {
    case 'claude':
      return avgClaudeCostUsd();
    case 'tts':
      return avgTtsCostUsd();
    case 'screenshot':
      return avgScreenshotCostUsd();
    default: {
      const never: never = namespace;
      throw new Error(`namespace de cache inconnu : ${String(never)}`);
    }
  }
}

/** Dérive taux de hit + économie estimée pour un namespace. */
export function deriveCacheStat(counts: CacheNamespaceCounts): CacheNamespaceStat {
  const total = counts.hits + counts.misses;
  const hitRate = total > 0 ? counts.hits / total : 0;
  const perHit = avgSavedUsd(counts.namespace);
  return {
    namespace: counts.namespace,
    hits: counts.hits,
    misses: counts.misses,
    total,
    hitRate,
    avgSavedUsd: round(perHit),
    estimatedSavingsUsd: round(counts.hits * perHit),
  };
}

/** Dérive les lignes de tous les namespaces + le total agrégé. */
export function deriveCacheStats(counts: readonly CacheNamespaceCounts[]): CacheNamespaceStat[] {
  return counts.map(deriveCacheStat);
}

/** Économie totale estimée (USD), tous namespaces confondus. */
export function totalEstimatedSavingsUsd(stats: readonly CacheNamespaceStat[]): number {
  return round(stats.reduce((acc, s) => acc + s.estimatedSavingsUsd, 0));
}

/** Taux de hit global (hits totaux / accès totaux), tous namespaces confondus. */
export function overallHitRate(stats: readonly CacheNamespaceStat[]): number {
  const totalHits = stats.reduce((acc, s) => acc + s.hits, 0);
  const totalAccess = stats.reduce((acc, s) => acc + s.total, 0);
  return totalAccess > 0 ? totalHits / totalAccess : 0;
}

function round(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/** Ré-export pour cohérence de nommage avec cost-stats.ts (non utilisé ici). */
export type { CostKind };
