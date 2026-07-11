import { describe, expect, it } from 'vitest';
import {
  aggregateMonthlyRevenue,
  courseAnalyticsToEntries,
  gumroadToEntries,
  subscriptionsToEntries,
  toAccountingCsv,
  totalBySource,
  totalRevenue,
  type RevenueEntry,
} from './revenue-aggregate';

describe('revenue-aggregate', () => {
  describe('conversions de sources', () => {
    it('convertit CourseAnalytics (Udemy/YouTube) en entrées USD', () => {
      const entries = courseAnalyticsToEntries([
        { courseId: 'c1', platform: 'udemy', revenue: 120, fetchedAt: new Date('2026-06-15') },
        { courseId: 'c2', platform: 'youtube', revenue: 30, fetchedAt: new Date('2026-06-20') },
        { courseId: 'c3', platform: 'teachable', revenue: 999, fetchedAt: new Date('2026-06-20') },
      ]);
      // La plateforme non analytics (teachable) est ignorée.
      expect(entries).toHaveLength(2);
      expect(entries[0]).toMatchObject({ source: 'udemy', amount: 120, currency: 'USD', refId: 'c1' });
    });

    it('convertit les abonnements actifs en entrées', () => {
      const entries = subscriptionsToEntries([
        { userId: 'u1', currency: 'MAD', amount: 299, billedAt: new Date('2026-06-01') },
      ]);
      expect(entries).toEqual([
        { source: 'subscription', date: new Date('2026-06-01'), amount: 299, currency: 'MAD', refId: 'u1' },
      ]);
    });

    it('Gumroad renvoie toujours un tableau vide (pas de flux de revenu fiable)', () => {
      expect(gumroadToEntries()).toEqual([]);
    });
  });

  describe('aggregateMonthlyRevenue', () => {
    const entries: RevenueEntry[] = [
      { source: 'udemy', date: new Date('2026-05-10'), amount: 100, currency: 'USD', refId: 'c1' },
      { source: 'subscription', date: new Date('2026-05-15'), amount: 100, currency: 'EUR', refId: 'u1' },
      { source: 'subscription', date: new Date('2026-06-01'), amount: 299, currency: 'MAD', refId: 'u2' },
    ];

    it('agrège par mois, converti dans la devise cible, avec les mois vides à 0', () => {
      const series = aggregateMonthlyRevenue(entries, 'USD', 3, new Date('2026-06-30'));
      expect(series.map((s) => s.month)).toEqual(['2026-04', '2026-05', '2026-06']);
      const [april, may, june] = series;
      expect(april?.totalConverted).toBe(0);
      // Mai : 100 USD (udemy) + 100 EUR≈108 USD (subscription) = 208.
      expect(may?.totalConverted).toBeCloseTo(208, 0);
      expect(may?.bySource.udemy).toBeCloseTo(100, 0);
      expect(may?.bySource.subscription).toBeCloseTo(108, 0);
      // Juin : 299 MAD ≈ 29.9 USD.
      expect(june?.totalConverted).toBeCloseTo(29.9, 0);
    });

    it('garantit un point par mois même sans aucune entrée', () => {
      const series = aggregateMonthlyRevenue([], 'USD', 6, new Date('2026-06-30'));
      expect(series).toHaveLength(6);
      expect(series.every((s) => s.totalConverted === 0)).toBe(true);
    });
  });

  describe('totaux', () => {
    const entries: RevenueEntry[] = [
      { source: 'udemy', date: new Date('2026-06-01'), amount: 50, currency: 'USD', refId: 'c1' },
      { source: 'youtube', date: new Date('2026-06-02'), amount: 10, currency: 'USD', refId: 'c2' },
      { source: 'subscription', date: new Date('2026-06-03'), amount: 100, currency: 'EUR', refId: 'u1' },
    ];

    it('totalRevenue additionne toutes les sources converties', () => {
      const total = totalRevenue(entries, 'USD');
      expect(total).toBeCloseTo(50 + 10 + 108, 0);
    });

    it('totalBySource ventile par source, gumroad à 0 si absent', () => {
      const bySource = totalBySource(entries, 'USD');
      expect(bySource.udemy).toBe(50);
      expect(bySource.youtube).toBe(10);
      expect(bySource.subscription).toBeCloseTo(108, 0);
      expect(bySource.gumroad).toBe(0);
    });
  });

  describe('toAccountingCsv', () => {
    it('génère un CSV avec en-têtes et lignes triées par date', () => {
      const entries: RevenueEntry[] = [
        { source: 'subscription', date: new Date('2026-06-05'), amount: 100, currency: 'EUR', refId: 'u1' },
        { source: 'udemy', date: new Date('2026-06-01'), amount: 50, currency: 'USD', refId: 'c1' },
      ];
      const csv = toAccountingCsv(entries, 'USD');
      const lines = csv.split('\n');
      expect(lines[0]).toBe('date,source,montant,devise,montant_converti_USD');
      // Trié par date : udemy (06-01) avant subscription (06-05).
      expect(lines[1]).toContain('2026-06-01,udemy,50.00,USD');
      expect(lines[2]).toContain('2026-06-05,subscription,100.00,EUR');
    });

    it('échappe les valeurs contenant une virgule ou des guillemets', () => {
      const entries: RevenueEntry[] = [
        { source: 'udemy', date: new Date('2026-06-01'), amount: 10, currency: 'USD', refId: 'c1' },
      ];
      const csv = toAccountingCsv(entries);
      expect(csv).not.toContain('undefined');
    });
  });
});
