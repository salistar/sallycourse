import { describe, expect, it } from 'vitest';
import {
  approvalStats,
  averagePerDay,
  courseStatusBreakdown,
  estimatedCost,
  fillDailySeries,
  formatCost,
  formatRate,
  planBreakdown,
  planUsageRatio,
  platformShares,
  sumDaily,
  topPlatform,
} from './stats';

// Tests des agrégations admin (P57) — fonctions PURES sur données mockées,
// aucune connexion Mongo.

describe('fillDailySeries', () => {
  it('produit un point par jour et met 0 pour les jours absents', () => {
    const end = new Date('2026-07-07T12:00:00Z');
    const series = fillDailySeries([{ day: '2026-07-06', count: 3 }], 3, end);
    expect(series).toEqual([
      { day: '2026-07-05', count: 0 },
      { day: '2026-07-06', count: 3 },
      { day: '2026-07-07', count: 0 },
    ]);
  });

  it('ignore les jours hors fenêtre', () => {
    const end = new Date('2026-07-07T00:00:00Z');
    const series = fillDailySeries(
      [
        { day: '2026-07-07', count: 5 },
        { day: '2026-06-01', count: 99 }, // hors fenêtre
      ],
      2,
      end,
    );
    expect(series).toEqual([
      { day: '2026-07-06', count: 0 },
      { day: '2026-07-07', count: 5 },
    ]);
  });

  it('retourne une série vide pour 0 jour', () => {
    expect(fillDailySeries([], 0, new Date('2026-07-07T00:00:00Z'))).toEqual([]);
  });
});

describe('sumDaily / averagePerDay', () => {
  const buckets = [
    { day: '2026-07-05', count: 2 },
    { day: '2026-07-06', count: 0 },
    { day: '2026-07-07', count: 4 },
  ];

  it('somme les compteurs', () => {
    expect(sumDaily(buckets)).toBe(6);
  });

  it('calcule la moyenne arrondie à 1 décimale', () => {
    expect(averagePerDay(buckets, 3)).toBe(2);
    expect(averagePerDay([{ day: 'x', count: 5 }], 3)).toBe(1.7);
  });

  it('renvoie 0 pour 0 jour (pas de division par zéro)', () => {
    expect(averagePerDay(buckets, 0)).toBe(0);
  });
});

describe('approvalStats', () => {
  it('calcule le taux sur les états terminaux uniquement', () => {
    const s = approvalStats([
      { status: 'published', count: 8 },
      { status: 'failed', count: 2 },
      { status: 'running', count: 5 }, // non terminal, exclu
      { status: 'pending', count: 3 }, // non terminal, exclu
    ]);
    expect(s.published).toBe(8);
    expect(s.failed).toBe(2);
    expect(s.terminal).toBe(10);
    expect(s.rate).toBeCloseTo(0.8);
  });

  it('rate = null sans aucun terminal', () => {
    const s = approvalStats([{ status: 'running', count: 4 }]);
    expect(s.rate).toBeNull();
    expect(s.terminal).toBe(0);
  });

  it('gère les buckets vides', () => {
    expect(approvalStats([])).toEqual({ published: 0, failed: 0, terminal: 0, rate: null });
  });
});

describe('formatRate', () => {
  it('formatte en pourcentage entier', () => {
    expect(formatRate(0.8)).toBe('80 %');
    expect(formatRate(0.876)).toBe('88 %');
    expect(formatRate(0)).toBe('0 %');
  });

  it('affiche un tiret pour null', () => {
    expect(formatRate(null)).toBe('—');
  });
});

describe('topPlatform', () => {
  it('retourne le plus fort effectif', () => {
    expect(
      topPlatform([
        { platform: 'youtube', count: 3 },
        { platform: 'udemy', count: 7 },
        { platform: 'teachable', count: 1 },
      ]),
    ).toEqual({ platform: 'udemy', count: 7 });
  });

  it('départage par ordre alphabétique en cas d’égalité', () => {
    expect(
      topPlatform([
        { platform: 'youtube', count: 5 },
        { platform: 'udemy', count: 5 },
      ]),
    ).toEqual({ platform: 'udemy', count: 5 });
  });

  it('retourne null si vide', () => {
    expect(topPlatform([])).toBeNull();
  });
});

describe('platformShares', () => {
  it('calcule les parts et trie par effectif décroissant', () => {
    const shares = platformShares([
      { platform: 'youtube', count: 1 },
      { platform: 'udemy', count: 3 },
    ]);
    expect(shares[0]).toMatchObject({ platform: 'udemy', count: 3 });
    expect(shares[0]!.share).toBeCloseTo(0.75);
    expect(shares[1]!.share).toBeCloseTo(0.25);
  });

  it('part = 0 quand le total est nul', () => {
    const shares = platformShares([{ platform: 'udemy', count: 0 }]);
    expect(shares[0]!.share).toBe(0);
  });
});

describe('courseStatusBreakdown', () => {
  it('normalise sur l’ordre canonique avec 0 pour les absents', () => {
    const order = ['draft', 'ready', 'published'] as const;
    const out = courseStatusBreakdown([{ status: 'ready', count: 4 }], order);
    expect(out).toEqual([
      { status: 'draft', count: 0 },
      { status: 'ready', count: 4 },
      { status: 'published', count: 0 },
    ]);
  });
});

describe('planBreakdown', () => {
  it('normalise sur l’ordre des plans avec 0 pour les absents', () => {
    const order = ['free', 'pro', 'business'] as const;
    const out = planBreakdown(
      [
        { plan: 'pro', count: 2 },
        { plan: 'free', count: 10 },
      ],
      order,
    );
    expect(out).toEqual([
      { plan: 'free', count: 10 },
      { plan: 'pro', count: 2 },
      { plan: 'business', count: 0 },
    ]);
  });
});

describe('estimatedCost / formatCost', () => {
  it('multiplie par le coût unitaire et arrondit au centime', () => {
    expect(estimatedCost(0)).toBe(0);
    expect(estimatedCost(5)).toBe(12);
    expect(estimatedCost(3)).toBeCloseTo(7.2);
  });

  it('borne les valeurs négatives à 0', () => {
    expect(estimatedCost(-2)).toBe(0);
  });

  it('formatte en dollars à deux décimales', () => {
    expect(formatCost(12)).toBe('$12.00');
    expect(formatCost(7.2)).toBe('$7.20');
  });
});

describe('planUsageRatio', () => {
  it('calcule un ratio borné 0-1', () => {
    expect(planUsageRatio(5, 10)).toBe(0.5);
    expect(planUsageRatio(15, 10)).toBe(1);
  });

  it('retourne null pour un quota infini ou nul', () => {
    expect(planUsageRatio(3, Infinity)).toBeNull();
    expect(planUsageRatio(3, 0)).toBeNull();
  });
});
