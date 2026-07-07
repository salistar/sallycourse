import { describe, expect, it } from 'vitest';
import {
  buildCatalog,
  estimateBatchSeconds,
  estimatePlatformSeconds,
  formatDuration,
  getCapabilities,
  isKnownPlatform,
  MAX_CONCURRENT_DEPLOYMENTS,
} from './deploy-catalog';

// Tests de la logique PURE du catalogue de déploiement (P44) : capacités,
// estimation de durée et ordonnancement concurrent. Aucun réseau/DB.

describe('getCapabilities', () => {
  it('retourne les capacités déclarées d’une plateforme connue', () => {
    const udemy = getCapabilities('udemy');
    expect(udemy.needsBrowser).toBe(true);
    expect(udemy.modes).toContain('auto');
  });

  it('retombe sur un défaut prudent pour une plateforme inconnue', () => {
    const caps = getCapabilities('inexistante');
    expect(caps.needsBrowser).toBe(false);
    expect(caps.modes).toEqual(['auto']);
  });
});

describe('isKnownPlatform', () => {
  it('reconnaît une plateforme du catalogue', () => {
    expect(isKnownPlatform('youtube')).toBe(true);
  });
  it('rejette une plateforme absente', () => {
    expect(isKnownPlatform('myspace')).toBe(false);
  });
});

describe('buildCatalog', () => {
  it('expose une entrée par plateforme avec ses capacités', () => {
    const catalog = buildCatalog();
    expect(catalog.length).toBeGreaterThan(0);
    for (const entry of catalog) {
      expect(entry.capabilities.modes.length).toBeGreaterThan(0);
      expect(typeof entry.capabilities.needsBrowser).toBe('boolean');
    }
  });
});

describe('estimatePlatformSeconds', () => {
  it('croît avec le nombre de leçons', () => {
    const few = estimatePlatformSeconds('thinkific', 2);
    const many = estimatePlatformSeconds('thinkific', 20);
    expect(many).toBeGreaterThan(few);
  });

  it('pénalise les plateformes nécessitant un navigateur', () => {
    // udemy (navigateur) vs thinkific (API) à nombre de leçons égal.
    const browser = estimatePlatformSeconds('udemy', 10);
    const api = estimatePlatformSeconds('thinkific', 10);
    expect(browser).toBeGreaterThan(api);
  });

  it('gère un nombre de leçons nul ou négatif sans planter', () => {
    expect(estimatePlatformSeconds('gumroad', 0)).toBeGreaterThan(0);
    expect(estimatePlatformSeconds('gumroad', -5)).toBe(estimatePlatformSeconds('gumroad', 0));
  });
});

describe('estimateBatchSeconds', () => {
  it('vaut la durée simple pour une seule plateforme', () => {
    const single = estimateBatchSeconds(['thinkific'], 10, 2);
    expect(single).toBe(estimatePlatformSeconds('thinkific', 10));
  });

  it('parallélise selon la concurrence (2 plateformes identiques ~ 1 voie)', () => {
    const one = estimatePlatformSeconds('thinkific', 10);
    // Deux plateformes identiques sur 2 voies → durée ≈ celle d’une seule.
    const two = estimateBatchSeconds(['thinkific', 'teachable'], 10, 2);
    // teachable (navigateur) est plus long ; la voie la plus chargée domine.
    expect(two).toBe(Math.max(one, estimatePlatformSeconds('teachable', 10)));
  });

  it('sérialise partiellement quand N > concurrence', () => {
    const ids = ['gumroad', 'gumroad', 'gumroad'];
    // 3 tâches identiques sur 2 voies → 2 lots (une voie fait 2 tâches).
    const total = estimateBatchSeconds(ids, 5, 2);
    const one = estimatePlatformSeconds('gumroad', 5);
    expect(total).toBe(one * 2);
  });

  it('respecte MAX_CONCURRENT_DEPLOYMENTS par défaut', () => {
    expect(MAX_CONCURRENT_DEPLOYMENTS).toBe(2);
    const withDefault = estimateBatchSeconds(['gumroad', 'gumroad', 'gumroad'], 5);
    const withExplicit = estimateBatchSeconds(['gumroad', 'gumroad', 'gumroad'], 5, 2);
    expect(withDefault).toBe(withExplicit);
  });
});

describe('formatDuration', () => {
  it('formate les secondes', () => {
    expect(formatDuration(30)).toBe('~30 s');
  });
  it('formate les minutes', () => {
    expect(formatDuration(120)).toBe('~2 min');
  });
  it('formate les heures avec reste', () => {
    expect(formatDuration(3600 + 600)).toBe('~1 h 10');
  });
  it('formate les heures pleines', () => {
    expect(formatDuration(7200)).toBe('~2 h');
  });
});
