// Logique PURE de classement des variantes A/B (P87) — miroir léger de
// apps/worker/src/deploy/ab-testing.ts (le web n'importe pas le worker,
// rootDir distinct). Sert uniquement à l'affichage du dashboard.

export interface VariantRow {
  variantIndex: number;
  title: string;
  isActive: boolean;
  impressions: number;
  conversions: number;
  lastActivatedAt: string | null;
}

export interface RankedVariantRow extends VariantRow {
  /** Taux de conversion 0..1 (arrondi à 4 décimales), 0 si aucune impression. */
  rate: number;
}

/** Arrondi à 4 décimales robuste aux erreurs flottantes. */
function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/** Taux de conversion approché (0 si aucune impression — évite la division par 0). */
export function conversionRate(impressions: number, conversions: number): number {
  if (impressions <= 0) return 0;
  return conversions / impressions;
}

/**
 * Classe les variantes par performance décroissante (taux de conversion), à
 * égalité par le plus grand nombre d'impressions (plus fiable statistiquement).
 */
export function rankVariants(rows: readonly VariantRow[]): RankedVariantRow[] {
  return rows
    .map((v) => ({ ...v, rate: round4(conversionRate(v.impressions, v.conversions)) }))
    .sort((a, b) => b.rate - a.rate || b.impressions - a.impressions);
}
