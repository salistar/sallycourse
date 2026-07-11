// Tests de l'orchestration cross-platform (Prompt 110) : génération UTM (pure)
// et structure de la recommandation en mode mock (aucun appel réseau).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildUtmParams,
  detectSubjectCategory,
  injectUtmIntoUrl,
  recommendDeploymentStrategy,
  slugifyUtm,
  utmQueryString,
  deploymentStrategySchema,
} from './cross-platform-strategy.js';
import { resetConfigCache } from '../shared.js';
import type { ICourse } from '../shared.js';

/* ------------------------------------------------------------------ */
/* Tracking UTM (pur)                                                   */
/* ------------------------------------------------------------------ */

describe('slugifyUtm', () => {
  it('retire accents/espaces et met en minuscules', () => {
    expect(slugifyUtm('Maîtriser DevOps & Café')).toBe('maitriser-devops-cafe');
  });

  it('retombe sur "cours" si la chaîne est vide après nettoyage', () => {
    expect(slugifyUtm('!!!')).toBe('cours');
  });

  it('tronque à 60 caractères', () => {
    const long = 'a'.repeat(200);
    expect(slugifyUtm(long).length).toBeLessThanOrEqual(60);
  });
});

describe('buildUtmParams', () => {
  it('construit des paramètres déterministes et stables', () => {
    const a = buildUtmParams('507f1f77bcf86cd799439011', 'Maîtriser DevOps', 'youtube');
    const b = buildUtmParams('507f1f77bcf86cd799439011', 'Maîtriser DevOps', 'youtube');
    expect(a).toEqual(b);
    expect(a.utm_source).toBe('youtube');
    expect(a.utm_medium).toBe('video');
    expect(a.utm_campaign).toBe('maitriser-devops');
  });

  it('choisit le médium selon la plateforme (lms/store/social/funnel)', () => {
    expect(buildUtmParams('id', 'Titre', 'udemy').utm_medium).toBe('lms');
    expect(buildUtmParams('id', 'Titre', 'gumroad').utm_medium).toBe('store');
    expect(buildUtmParams('id', 'Titre', 'linkedin').utm_medium).toBe('social');
    expect(buildUtmParams('id', 'Titre', 'systeme-io').utm_medium).toBe('funnel');
  });

  it('retombe sur "referral" pour une plateforme inconnue', () => {
    expect(buildUtmParams('id', 'Titre', 'plateforme-inconnue').utm_medium).toBe('referral');
  });
});

describe('utmQueryString / injectUtmIntoUrl', () => {
  it('sérialise les paramètres en query string', () => {
    const params = buildUtmParams('id', 'Mon Cours', 'youtube');
    const qs = utmQueryString(params);
    expect(qs).toContain('utm_source=youtube');
    expect(qs).toContain('utm_medium=video');
  });

  it('injecte les UTM dans une URL sans query existante', () => {
    const params = buildUtmParams('id', 'Mon Cours', 'udemy');
    const url = injectUtmIntoUrl('https://udemy.com/course/mon-cours', params);
    expect(url).toContain('utm_source=udemy');
    expect(url.startsWith('https://udemy.com/course/mon-cours?')).toBe(true);
  });

  it('préserve les query params existants', () => {
    const params = buildUtmParams('id', 'Mon Cours', 'udemy');
    const url = injectUtmIntoUrl('https://udemy.com/course/mon-cours?ref=abc', params);
    expect(url).toContain('ref=abc');
    expect(url).toContain('utm_source=udemy');
  });

  it('retombe sur une concaténation best-effort si l’URL est invalide', () => {
    const params = buildUtmParams('id', 'Mon Cours', 'udemy');
    const out = injectUtmIntoUrl('pas-une-url', params);
    expect(out).toContain('pas-une-url?');
    expect(out).toContain('utm_source=udemy');
  });
});

/* ------------------------------------------------------------------ */
/* Détection de catégorie (pure)                                        */
/* ------------------------------------------------------------------ */

describe('detectSubjectCategory', () => {
  it('détecte "tech" sur un titre DevOps', () => {
    expect(detectSubjectCategory('Maîtriser DevOps de A à Z')).toBe('tech');
  });

  it('détecte "business" sur un titre marketing', () => {
    expect(detectSubjectCategory('Stratégie marketing pour entrepreneurs')).toBe('business');
  });

  it('détecte "creative" sur un titre design', () => {
    expect(detectSubjectCategory('Design graphique pour débutants')).toBe('creative');
  });

  it('détecte "lifestyle" sur un titre yoga', () => {
    expect(detectSubjectCategory('Yoga et bien-être au quotidien')).toBe('lifestyle');
  });

  it('retombe sur "generic" si aucun mot-clé ne matche', () => {
    expect(detectSubjectCategory('Sujet totalement neutre')).toBe('generic');
  });

  it('cherche aussi dans la description', () => {
    expect(detectSubjectCategory('Cours avancé', 'Apprendre Python et Docker')).toBe('tech');
  });
});

/* ------------------------------------------------------------------ */
/* Recommandation (mode mock)                                          */
/* ------------------------------------------------------------------ */

function course(partial: Partial<ICourse> = {}): ICourse {
  return {
    title: 'Maîtriser DevOps',
    difficulty: 'intermediate',
    locale: 'fr',
    targetPlatforms: ['udemy'],
    outline: { description: '' },
    ...partial,
  } as unknown as ICourse;
}

describe('recommendDeploymentStrategy (mock)', () => {
  beforeEach(() => {
    Object.assign(process.env, {
      APP_URL: 'http://localhost:3000',
      MONGO_URI: 'mongodb://localhost:27017/test',
      REDIS_URL: 'redis://localhost:6379',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_ACCESS_KEY: 'test',
      S3_SECRET_KEY: 'test',
      S3_BUCKET: 'test',
      S3_REGION: 'us-east-1',
      AUTH_SECRET: 'test-secret-at-least-32-characters-long!!',
      CREDENTIALS_MASTER_KEY: 'a'.repeat(64),
      MOCK_PROVIDERS: 'true',
    });
    resetConfigCache();
  });
  afterEach(() => resetConfigCache());

  it('retourne une structure conforme au schéma pour un cours tech', async () => {
    const strategy = await recommendDeploymentStrategy(course());
    expect(() => deploymentStrategySchema.parse(strategy)).not.toThrow();
    expect(strategy.recommendedPlatforms.length).toBeGreaterThan(0);
    expect(strategy.recommendedPlatforms.some((p) => p.platform === 'udemy')).toBe(true);
    expect(strategy.calendarPlan.length).toBeGreaterThan(0);
  });

  it('recommande une stratégie business pour un cours marketing', async () => {
    const strategy = await recommendDeploymentStrategy(
      course({ title: 'Stratégie marketing digital' }),
    );
    expect(strategy.recommendedPlatforms.some((p) => p.platform === 'systeme-io')).toBe(true);
  });

  it('retombe sur la stratégie générique pour un sujet neutre', async () => {
    const strategy = await recommendDeploymentStrategy(course({ title: 'Sujet totalement neutre' }));
    expect(strategy.recommendedPlatforms.some((p) => p.platform === 'udemy')).toBe(true);
    expect(strategy.recommendedPlatforms.some((p) => p.platform === 'youtube')).toBe(true);
  });

  it('tous les dayOffset du calendrier sont des entiers ≥ 0', async () => {
    const strategy = await recommendDeploymentStrategy(course());
    for (const entry of strategy.calendarPlan) {
      expect(Number.isInteger(entry.dayOffset)).toBe(true);
      expect(entry.dayOffset).toBeGreaterThanOrEqual(0);
    }
  });
});
