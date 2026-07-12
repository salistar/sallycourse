import { describe, expect, it } from 'vitest';
import { resolveUmamiConfig } from './umami-config';

/**
 * Smoke test du tracking Umami (P157) : pas de harnais de rendu React
 * installé dans ce projet (@testing-library/react absent, voir
 * apps/web/src/app/(marketing)/page.test.ts) — on vérifie donc directement
 * la fonction pure de résolution de config consommée par UmamiScript.
 */

describe('resolveUmamiConfig', () => {
  it('no-op quand rien n’est configuré (comportement par défaut, RGPD neutre)', () => {
    expect(resolveUmamiConfig({})).toBeNull();
  });

  it('no-op quand seul NEXT_PUBLIC_UMAMI_SRC est fourni (websiteId requis)', () => {
    expect(resolveUmamiConfig({ NEXT_PUBLIC_UMAMI_SRC: 'https://umami.exemple.com/script.js' })).toBeNull();
  });

  it('no-op quand websiteId est une chaîne vide/blanche', () => {
    expect(resolveUmamiConfig({ NEXT_PUBLIC_UMAMI_WEBSITE_ID: '   ' })).toBeNull();
  });

  it('résout avec le src par défaut (service docker-compose local) si non fourni', () => {
    const config = resolveUmamiConfig({ NEXT_PUBLIC_UMAMI_WEBSITE_ID: 'abc-123' });
    expect(config).toEqual({ src: 'http://localhost:3002/script.js', websiteId: 'abc-123' });
  });

  it('respecte un src personnalisé (instance Umami de production)', () => {
    const config = resolveUmamiConfig({
      NEXT_PUBLIC_UMAMI_SRC: 'https://umami.sallycourse.com/script.js',
      NEXT_PUBLIC_UMAMI_WEBSITE_ID: 'prod-uuid',
    });
    expect(config).toEqual({ src: 'https://umami.sallycourse.com/script.js', websiteId: 'prod-uuid' });
  });

  it('trim les valeurs fournies', () => {
    const config = resolveUmamiConfig({
      NEXT_PUBLIC_UMAMI_SRC: '  https://umami.exemple.com/script.js  ',
      NEXT_PUBLIC_UMAMI_WEBSITE_ID: '  abc-123  ',
    });
    expect(config).toEqual({ src: 'https://umami.exemple.com/script.js', websiteId: 'abc-123' });
  });
});
