import { describe, expect, it } from 'vitest';
import { extractSubdomain } from './white-label';

// Tests P143 (sous-domaines white-label) — extractSubdomain est PURE
// (aucun import Mongoose) : c'est ce que consomme middleware.ts (Edge
// Runtime). La résolution I/O (resolveWhiteLabelSite) est testée séparément
// dans white-label.server.test.ts.

describe('extractSubdomain', () => {
  const root = 'sallycourse.com';

  it('extrait le sous-domaine d’un host normal', () => {
    expect(extractSubdomain('academie-client.sallycourse.com', root)).toBe('academie-client');
  });

  it('ignore le port éventuel', () => {
    expect(extractSubdomain('academie-client.sallycourse.com:3000', root)).toBe('academie-client');
  });

  it('retourne null pour le domaine racine nu (avec ou sans www)', () => {
    expect(extractSubdomain('sallycourse.com', root)).toBeNull();
    expect(extractSubdomain('www.sallycourse.com', root)).toBeNull();
  });

  it('retourne null pour localhost / IP / host vide', () => {
    expect(extractSubdomain('localhost:3000', root)).toBeNull();
    expect(extractSubdomain('127.0.0.1:3000', root)).toBeNull();
    expect(extractSubdomain(null, root)).toBeNull();
    expect(extractSubdomain(undefined, root)).toBeNull();
  });

  it('supporte le sous-domaine en dev via .localhost', () => {
    expect(extractSubdomain('academie-client.localhost:3000', root)).toBe('academie-client');
    expect(extractSubdomain('www.localhost:3000', root)).toBeNull();
  });

  it('retourne null pour un domaine totalement différent (custom domain non supporté)', () => {
    expect(extractSubdomain('www.autredomaine.com', root)).toBeNull();
    expect(extractSubdomain('academie-client.com', root)).toBeNull();
  });

  it('retourne null pour un sous-sous-domaine (profondeur non supportée)', () => {
    expect(extractSubdomain('a.b.sallycourse.com', root)).toBeNull();
  });

  it('est insensible à la casse', () => {
    expect(extractSubdomain('Academie-Client.SallyCourse.com', root)).toBe('academie-client');
  });
});
