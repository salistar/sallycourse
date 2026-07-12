// Tests du calendrier promotionnel suggéré (Prompt 139) : repli déterministe
// en mode mock (aucun appel réseau), forme du schéma. Logique pure côté
// shared (resolveGenericPromoPeriods) déjà testée dans packages/shared.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetConfigCache } from '../shared.js';
import { promoCalendarSchema, suggestPromoCalendar } from './promo-calendar.js';

function setTestEnv(overrides: Record<string, string> = {}): void {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    APP_URL: 'http://localhost:3000',
    MONGO_URI: 'mongodb://localhost:27017/test',
    REDIS_URL: 'redis://localhost:6379',
    S3_ENDPOINT: 'http://localhost:9000',
    S3_ACCESS_KEY: 'test',
    S3_SECRET_KEY: 'test',
    S3_BUCKET: 'test',
    S3_REGION: 'us-east-1',
    AUTH_SECRET: 'secret-de-test-suffisamment-long',
    CREDENTIALS_MASTER_KEY: 'a'.repeat(64),
    ANTHROPIC_API_KEY: 'sk-ant-test',
    MOCK_PROVIDERS: 'true',
    ...overrides,
  });
  resetConfigCache();
}

beforeEach(() => setTestEnv());
afterEach(() => resetConfigCache());

describe('suggestPromoCalendar (mode mock)', () => {
  it('retourne un calendrier générique conforme au schéma sans appel réseau', async () => {
    const result = await suggestPromoCalendar({
      courseTitle: 'Apprendre React',
      difficulty: 'beginner',
      year: 2026,
    });
    expect(promoCalendarSchema.safeParse(result).success).toBe(true);
    expect(result.periods.length).toBeGreaterThanOrEqual(2);
    for (const p of result.periods) {
      expect(p.startDate.startsWith('2026-')).toBe(true);
      expect(p.discountPercent).toBeGreaterThan(0);
    }
  });

  it('utilise l’année courante par défaut si non précisée', async () => {
    const currentYear = new Date().getFullYear();
    const result = await suggestPromoCalendar({ courseTitle: 'Cours quelconque', difficulty: 'advanced' });
    expect(result.periods[0]!.startDate.startsWith(String(currentYear))).toBe(true);
  });
});

describe('promoCalendarSchema', () => {
  it('rejette une période mal formée (date invalide)', () => {
    const invalid = {
      periods: [
        { name: 'Test', startDate: '2026/09/01', endDate: '2026-09-15', discountPercent: 30, rationale: 'x' },
      ],
    };
    expect(promoCalendarSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejette moins de 2 périodes', () => {
    const invalid = {
      periods: [
        { name: 'Test', startDate: '2026-09-01', endDate: '2026-09-15', discountPercent: 30, rationale: 'x' },
      ],
    };
    expect(promoCalendarSchema.safeParse(invalid).success).toBe(false);
  });
});
