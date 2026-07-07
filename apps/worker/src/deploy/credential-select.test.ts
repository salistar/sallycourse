// Tests de la sélection PURE du compte plateforme (multi-comptes, P49).
import { describe, expect, it } from 'vitest';
import { selectCredential, type CredentialCandidate } from './credential-select.js';

const udemyFr: CredentialCandidate = { id: 'fr', platform: 'udemy', accountLabel: 'Udemy FR' };
const udemyEn: CredentialCandidate = { id: 'en', platform: 'udemy', accountLabel: 'Udemy EN' };

describe('selectCredential', () => {
  it('retourne le compte désigné par credentialId', () => {
    const chosen = selectCredential([udemyFr, udemyEn], 'en');
    expect(chosen?.id).toBe('en');
  });

  it('choisit le premier compte (le plus récent) sans credentialId', () => {
    // L'appelant fournit la liste triée récents d'abord → [0] = choix par défaut.
    expect(selectCredential([udemyEn, udemyFr])?.id).toBe('en');
  });

  it('ne retombe PAS sur un autre compte si le credentialId est introuvable', () => {
    // Sécurité : ne jamais publier avec le mauvais compte.
    expect(selectCredential([udemyFr, udemyEn], 'absent')).toBeUndefined();
  });

  it('retourne undefined si aucun compte connecté', () => {
    expect(selectCredential([])).toBeUndefined();
    expect(selectCredential([], 'fr')).toBeUndefined();
  });

  it('sélectionne le bon compte parmi plusieurs de la même plateforme', () => {
    const list = [udemyFr, udemyEn];
    expect(selectCredential(list, 'fr')?.accountLabel).toBe('Udemy FR');
    expect(selectCredential(list, 'en')?.accountLabel).toBe('Udemy EN');
  });
});
