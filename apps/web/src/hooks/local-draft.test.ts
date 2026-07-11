import { describe, expect, it } from 'vitest';
import { clearLocalDraft, readLocalDraft, shouldOfferRecovery, writeLocalDraft } from './local-draft';

/** Mock minimal de l'API Storage (pas de jsdom dans ce workspace). */
function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

describe('local-draft', () => {
  it('écrit puis relit un brouillon identique', () => {
    const storage = createMemoryStorage();
    writeLocalDraft('scope-1', { markdown: 'hello' }, storage);
    const draft = readLocalDraft<{ markdown: string }>('scope-1', storage);
    expect(draft?.value).toEqual({ markdown: 'hello' });
    expect(typeof draft?.savedAt).toBe('string');
  });

  it('retourne null si aucun brouillon pour ce scope', () => {
    const storage = createMemoryStorage();
    expect(readLocalDraft('absent', storage)).toBeNull();
  });

  it('isole les scopes : deux leçons différentes ne se marchent pas dessus', () => {
    const storage = createMemoryStorage();
    writeLocalDraft('lesson-a', 'contenu A', storage);
    writeLocalDraft('lesson-b', 'contenu B', storage);
    expect(readLocalDraft<string>('lesson-a', storage)?.value).toBe('contenu A');
    expect(readLocalDraft<string>('lesson-b', storage)?.value).toBe('contenu B');
  });

  it('clearLocalDraft efface le brouillon', () => {
    const storage = createMemoryStorage();
    writeLocalDraft('scope-1', 'x', storage);
    clearLocalDraft('scope-1', storage);
    expect(readLocalDraft('scope-1', storage)).toBeNull();
  });

  it('lit un JSON corrompu sans lever — retourne null', () => {
    const storage = createMemoryStorage();
    storage.setItem('sallycourse:draft:scope-1', '{not-json');
    expect(readLocalDraft('scope-1', storage)).toBeNull();
  });

  it('writeLocalDraft ne lève pas si setItem échoue (quota dépassé)', () => {
    const storage = createMemoryStorage();
    storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(() => writeLocalDraft('scope-1', 'x', storage)).not.toThrow();
  });
});

describe('shouldOfferRecovery', () => {
  it('false si aucun brouillon', () => {
    expect(shouldOfferRecovery(null, 'server value')).toBe(false);
  });

  it('false si le brouillon est identique à la valeur serveur (rien à récupérer)', () => {
    expect(
      shouldOfferRecovery({ value: 'same', savedAt: new Date().toISOString() }, 'same'),
    ).toBe(false);
  });

  it('true si le brouillon diffère de la valeur serveur', () => {
    expect(
      shouldOfferRecovery({ value: 'draft version', savedAt: new Date().toISOString() }, 'server version'),
    ).toBe(true);
  });

  it('compare par valeur (objets/tableaux), pas par référence', () => {
    const draft = { value: [{ a: 1 }], savedAt: new Date().toISOString() };
    expect(shouldOfferRecovery(draft, [{ a: 1 }])).toBe(false);
    expect(shouldOfferRecovery(draft, [{ a: 2 }])).toBe(true);
  });
});
