// Tests des fonctions PURES de l'A/B testing landing (P87) : sélection
// round-robin déterministe, calendrier de rotation, calcul du taux de
// conversion et classement des variantes. Aucune I/O (pas de Mongo/BullMQ).
import { describe, expect, it } from 'vitest';
import {
  conversionRate,
  isRotationDue,
  nextVariantIndex,
  rankVariantPerformance,
} from './ab-testing.js';

describe('nextVariantIndex', () => {
  it('démarre à 0 quand aucune variante n’est active', () => {
    expect(nextVariantIndex(-1, 5)).toBe(0);
  });

  it('avance séquentiellement (round-robin)', () => {
    expect(nextVariantIndex(0, 5)).toBe(1);
    expect(nextVariantIndex(1, 5)).toBe(2);
    expect(nextVariantIndex(3, 5)).toBe(4);
  });

  it('boucle sur 0 après la dernière variante', () => {
    expect(nextVariantIndex(4, 5)).toBe(0);
  });

  it('est déterministe pour un même total', () => {
    const total = 5;
    const sequence = [-1, 0, 1, 2, 3, 4];
    const results = sequence.reduce<number[]>((acc, cur) => {
      acc.push(nextVariantIndex(cur, total));
      return acc;
    }, []);
    expect(results).toEqual([0, 1, 2, 3, 4, 0]);
  });

  it('jette si aucune variante disponible', () => {
    expect(() => nextVariantIndex(-1, 0)).toThrow();
  });
});

describe('isRotationDue', () => {
  const periodMs = 7 * 24 * 60 * 60 * 1000;

  it('est due immédiatement si aucune activation précédente', () => {
    expect(isRotationDue(undefined, new Date())).toBe(true);
  });

  it('n’est pas due avant la fin de la période', () => {
    const now = new Date('2026-07-11T00:00:00Z');
    const last = new Date('2026-07-08T00:00:00Z'); // 3 jours avant
    expect(isRotationDue(last, now, periodMs)).toBe(false);
  });

  it('est due exactement à la période écoulée', () => {
    const now = new Date('2026-07-11T00:00:00Z');
    const last = new Date('2026-07-04T00:00:00Z'); // 7 jours avant
    expect(isRotationDue(last, now, periodMs)).toBe(true);
  });

  it('est due après la période écoulée', () => {
    const now = new Date('2026-07-11T00:00:00Z');
    const last = new Date('2026-06-01T00:00:00Z');
    expect(isRotationDue(last, now, periodMs)).toBe(true);
  });
});

describe('conversionRate', () => {
  it('retourne 0 sans impressions (évite la division par 0)', () => {
    expect(conversionRate(0, 0)).toBe(0);
    expect(conversionRate(0, 5)).toBe(0);
  });

  it('calcule enrollments / impressions', () => {
    expect(conversionRate(100, 10)).toBeCloseTo(0.1);
    expect(conversionRate(200, 50)).toBeCloseTo(0.25);
  });

  it('gère un taux de 100%', () => {
    expect(conversionRate(10, 10)).toBe(1);
  });
});

describe('rankVariantPerformance', () => {
  it('classe par taux de conversion décroissant', () => {
    const ranked = rankVariantPerformance([
      { variantIndex: 0, title: 'A', isActive: false, impressions: 100, conversions: 5 },
      { variantIndex: 1, title: 'B', isActive: true, impressions: 100, conversions: 20 },
      { variantIndex: 2, title: 'C', isActive: false, impressions: 100, conversions: 10 },
    ]);
    expect(ranked.map((v) => v.variantIndex)).toEqual([1, 2, 0]);
    expect(ranked[0]!.rate).toBeCloseTo(0.2);
  });

  it('départage à égalité de taux par le plus grand nombre d’impressions', () => {
    const ranked = rankVariantPerformance([
      { variantIndex: 0, title: 'A', isActive: false, impressions: 50, conversions: 5 }, // 0.1
      { variantIndex: 1, title: 'B', isActive: false, impressions: 200, conversions: 20 }, // 0.1
    ]);
    expect(ranked.map((v) => v.variantIndex)).toEqual([1, 0]);
  });

  it('gère une variante sans impressions (taux 0, en fin de classement)', () => {
    const ranked = rankVariantPerformance([
      { variantIndex: 0, title: 'A', isActive: false, impressions: 0, conversions: 0 },
      { variantIndex: 1, title: 'B', isActive: true, impressions: 100, conversions: 10 },
    ]);
    expect(ranked[0]!.variantIndex).toBe(1);
    expect(ranked[1]!.rate).toBe(0);
  });

  it('liste vide → résultat vide', () => {
    expect(rankVariantPerformance([])).toEqual([]);
  });
});
