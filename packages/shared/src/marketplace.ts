/**
 * Marketplace de cours entre utilisateurs (Prompt 147) : logique PURE (aucune
 * I/O) — calcul du partage de revenu (commission plateforme configurable) et
 * validation de la forme d'un listing. La duplication réelle du Course (I/O
 * DB) vit côté worker (voir apps/worker/src/lib/marketplace-purchase.ts), qui
 * réutilise la logique de dérivation de P64 sans re-générer le contenu via LLM.
 */

export const DEFAULT_MARKETPLACE_FEE_RATE = 0.2;

export interface RevenueShareResult {
  /** Prix brut payé par l'acheteur (centimes). */
  priceCents: number;
  /** Commission plateforme prélevée (centimes), arrondie à l'entier le plus proche. */
  platformFeeCents: number;
  /** Revenu net crédité au vendeur (centimes) = priceCents - platformFeeCents. */
  sellerNetCents: number;
}

/**
 * Calcule le partage de revenu d'une vente marketplace. `feeRate` est le taux
 * de commission plateforme (0.2 = 20%), figé sur le listing au moment de sa
 * création — jamais recalculé rétroactivement si le taux par défaut change.
 * Un prix de 0 (gratuit) donne un partage entièrement nul (rien à percevoir).
 * Bornes : feeRate est clampé à [0, 1] pour ne jamais produire de montants
 * négatifs même si une valeur invalide a été stockée par erreur.
 */
export function computeRevenueShare(priceCents: number, feeRate: number): RevenueShareResult {
  const price = Math.max(0, Math.round(priceCents));
  const rate = Math.min(1, Math.max(0, feeRate));

  if (price <= 0) {
    return { priceCents: 0, platformFeeCents: 0, sellerNetCents: 0 };
  }

  const platformFeeCents = Math.round(price * rate);
  const sellerNetCents = Math.max(0, price - platformFeeCents);
  return { priceCents: price, platformFeeCents, sellerNetCents };
}

export type MarketplaceLicenseTypeLike = 'course-copy' | 'template-only';

/** Un listing doit avoir un prix >= 0 et un taux de commission dans [0,1] pour être publiable. */
export function isValidListingShape(input: {
  priceCents: number;
  platformFeeRate: number;
  licenseType: MarketplaceLicenseTypeLike;
}): boolean {
  if (!Number.isFinite(input.priceCents) || input.priceCents < 0) return false;
  if (!Number.isFinite(input.platformFeeRate) || input.platformFeeRate < 0 || input.platformFeeRate > 1) {
    return false;
  }
  return input.licenseType === 'course-copy' || input.licenseType === 'template-only';
}

/** Libellé de prix affichable (« Gratuit » si 0), même format que les autres catalogues (LMS, showcase). */
export function marketplacePriceLabel(cents: number, currency: string, locale = 'fr-FR'): string {
  if (!cents || cents <= 0) return 'Gratuit';
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}
