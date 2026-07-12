// Tests purs (P147) : partage de revenu marketplace, validation de la forme
// d'un listing, libellé de prix. Aucune I/O.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MARKETPLACE_FEE_RATE,
  computeRevenueShare,
  isValidListingShape,
  marketplacePriceLabel,
} from './marketplace';

describe('computeRevenueShare', () => {
  it('applique la commission par défaut de 20%', () => {
    const result = computeRevenueShare(10000, DEFAULT_MARKETPLACE_FEE_RATE);
    expect(result).toEqual({ priceCents: 10000, platformFeeCents: 2000, sellerNetCents: 8000 });
  });

  it('gère un taux personnalisé (ex. 30%)', () => {
    const result = computeRevenueShare(5000, 0.3);
    expect(result.platformFeeCents).toBe(1500);
    expect(result.sellerNetCents).toBe(3500);
  });

  it('un prix gratuit ne génère aucun partage', () => {
    expect(computeRevenueShare(0, 0.2)).toEqual({ priceCents: 0, platformFeeCents: 0, sellerNetCents: 0 });
  });

  it('arrondit la commission à l’entier le plus proche', () => {
    // 999 * 0.2 = 199.8 → arrondi à 200
    const result = computeRevenueShare(999, 0.2);
    expect(result.platformFeeCents).toBe(200);
    expect(result.sellerNetCents).toBe(799);
  });

  it('clampe un taux de commission hors bornes (garde-fou)', () => {
    const tooHigh = computeRevenueShare(1000, 1.5);
    expect(tooHigh.platformFeeCents).toBe(1000);
    expect(tooHigh.sellerNetCents).toBe(0);

    const negative = computeRevenueShare(1000, -0.5);
    expect(negative.platformFeeCents).toBe(0);
    expect(negative.sellerNetCents).toBe(1000);
  });

  it('ne produit jamais de montants négatifs même avec un prix non entier', () => {
    const result = computeRevenueShare(1.4, 0.2);
    expect(result.priceCents).toBe(1);
    expect(result.sellerNetCents).toBeGreaterThanOrEqual(0);
  });

  it('la somme commission + net reconstitue toujours le prix', () => {
    for (const price of [1, 33, 100, 12345, 999999]) {
      const r = computeRevenueShare(price, 0.2);
      expect(r.platformFeeCents + r.sellerNetCents).toBe(r.priceCents);
    }
  });
});

describe('isValidListingShape', () => {
  it('accepte un listing course-copy valide', () => {
    expect(
      isValidListingShape({ priceCents: 5000, platformFeeRate: 0.2, licenseType: 'course-copy' }),
    ).toBe(true);
  });

  it('accepte un listing gratuit template-only', () => {
    expect(
      isValidListingShape({ priceCents: 0, platformFeeRate: 0.2, licenseType: 'template-only' }),
    ).toBe(true);
  });

  it('refuse un prix négatif', () => {
    expect(
      isValidListingShape({ priceCents: -100, platformFeeRate: 0.2, licenseType: 'course-copy' }),
    ).toBe(false);
  });

  it('refuse un taux de commission hors [0,1]', () => {
    expect(
      isValidListingShape({ priceCents: 100, platformFeeRate: 1.2, licenseType: 'course-copy' }),
    ).toBe(false);
    expect(
      isValidListingShape({ priceCents: 100, platformFeeRate: -0.1, licenseType: 'course-copy' }),
    ).toBe(false);
  });

  it('refuse un licenseType inconnu', () => {
    expect(
      isValidListingShape({
        priceCents: 100,
        platformFeeRate: 0.2,
        licenseType: 'bogus' as never,
      }),
    ).toBe(false);
  });
});

describe('marketplacePriceLabel', () => {
  it('affiche "Gratuit" pour un prix nul', () => {
    expect(marketplacePriceLabel(0, 'MAD')).toBe('Gratuit');
  });

  it('formate un prix payant dans la devise donnée', () => {
    expect(marketplacePriceLabel(29900, 'MAD')).toMatch(/299/);
  });
});
