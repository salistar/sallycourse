// Tests de la logique pure de classement A/B (P87).
import { describe, expect, it } from 'vitest';
import { conversionRate, rankVariants, type VariantRow } from './ab-testing';

function row(partial: Partial<VariantRow>): VariantRow {
  return {
    variantIndex: 0,
    title: 'Titre',
    isActive: false,
    impressions: 0,
    conversions: 0,
    lastActivatedAt: null,
    ...partial,
  };
}

describe('conversionRate', () => {
  it('retourne 0 sans impressions', () => {
    expect(conversionRate(0, 0)).toBe(0);
  });

  it('calcule conversions / impressions', () => {
    expect(conversionRate(100, 25)).toBeCloseTo(0.25);
  });
});

describe('rankVariants', () => {
  it('classe par taux de conversion décroissant', () => {
    const ranked = rankVariants([
      row({ variantIndex: 0, impressions: 100, conversions: 5 }),
      row({ variantIndex: 1, impressions: 100, conversions: 20, isActive: true }),
      row({ variantIndex: 2, impressions: 100, conversions: 10 }),
    ]);
    expect(ranked.map((v) => v.variantIndex)).toEqual([1, 2, 0]);
  });

  it('départage à égalité par le plus grand nombre d’impressions', () => {
    const ranked = rankVariants([
      row({ variantIndex: 0, impressions: 50, conversions: 5 }),
      row({ variantIndex: 1, impressions: 200, conversions: 20 }),
    ]);
    expect(ranked.map((v) => v.variantIndex)).toEqual([1, 0]);
  });

  it('liste vide → résultat vide', () => {
    expect(rankVariants([])).toEqual([]);
  });
});
