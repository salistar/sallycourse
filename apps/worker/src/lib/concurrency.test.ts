// Tests du verrou optimiste (Prompt 120) : retryOnVersionConflict/saveFieldWithRetry.
// Simule un « faux Mongoose » minimal avec compteur de version (__v) et VersionError,
// pour vérifier le comportement de retry SANS dépendre d'une vraie connexion Mongo.
import { describe, expect, it, vi } from 'vitest';
import { isVersionError, retryOnVersionConflict, saveFieldWithRetry } from './concurrency.js';

/** Erreur homonyme de mongoose.Error.VersionError (même `name`, pas besoin d'importer mongoose). */
class FakeVersionError extends Error {
  constructor() {
    super('No matching document found for id with version');
    this.name = 'VersionError';
  }
}

/**
 * Store en mémoire simulant une collection Mongo à un seul document, avec
 * verrou optimiste : chaque `save()` compare le `__v` capturé au CHARGEMENT à
 * celui actuellement en base ; s'ils diffèrent, VersionError (comme Mongoose).
 * Sinon, la sauvegarde incrémente `__v` en base — exactement la sémantique
 * d'optimisticConcurrency.
 */
function createFakeCourseStore(initial: { fields: Record<string, unknown> }) {
  let backing: Record<string, unknown> & { __v: number } = { ...initial.fields, __v: 0 };

  function load() {
    const snapshotVersion = backing.__v as number;
    const doc = {
      ...structuredClone(backing),
      save: vi.fn(async () => {
        if (doc.__v !== backing.__v) {
          throw new FakeVersionError();
        }
        // Applique les champs mutés sur `doc` (hors __v/save) à la base, puis incrémente.
        const { __v: _v, save: _s, ...fields } = doc as Record<string, unknown> & { __v: number };
        backing = { ...fields, __v: snapshotVersion + 1 };
        doc.__v = backing.__v;
      }),
    };
    return doc;
  }

  return { load, getBacking: () => backing };
}

describe('isVersionError', () => {
  it('reconnaît une VersionError', () => {
    expect(isVersionError(new FakeVersionError())).toBe(true);
  });

  it('rejette une erreur normale', () => {
    expect(isVersionError(new Error('autre chose'))).toBe(false);
  });

  it('rejette une valeur non-Error', () => {
    expect(isVersionError('boom')).toBe(false);
    expect(isVersionError(undefined)).toBe(false);
  });
});

describe('retryOnVersionConflict', () => {
  it('retourne le résultat au premier essai si pas de conflit', async () => {
    const fn = vi.fn(async () => 'ok');
    const result = await retryOnVersionConflict(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retente après un VersionError puis réussit', async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new FakeVersionError();
      return 'ok-après-retry';
    });
    const result = await retryOnVersionConflict(fn, { retries: 5 });
    expect(result).toBe('ok-après-retry');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('ne retente PAS sur une erreur qui n’est pas un conflit de version', async () => {
    const fn = vi.fn(async () => {
      throw new Error('panne réseau');
    });
    await expect(retryOnVersionConflict(fn)).rejects.toThrow('panne réseau');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('abandonne après épuisement des tentatives et remonte la dernière erreur', async () => {
    const fn = vi.fn(async () => {
      throw new FakeVersionError();
    });
    await expect(retryOnVersionConflict(fn, { retries: 2 })).rejects.toThrow(/version/i);
    expect(fn).toHaveBeenCalledTimes(3); // 1 essai initial + 2 retries
  });
});

describe('saveFieldWithRetry', () => {
  it('sauvegarde directement si aucun conflit', async () => {
    const store = createFakeCourseStore({ fields: { title: 'Cours A', tag: null } });
    const doc = store.load();
    const result = await saveFieldWithRetry(
      doc,
      async () => store.load(),
      (d) => {
        (d as unknown as { tag: string }).tag = 'v1';
      },
    );
    expect(result).not.toBeNull();
    expect(store.getBacking().tag).toBe('v1');
    expect(store.getBacking().__v).toBe(1);
  });

  it('recharge et réapplique la mutation après un conflit de version concurrent', async () => {
    const store = createFakeCourseStore({ fields: { title: 'Cours B', tag: null } });
    const staleDoc = store.load();

    // Un autre "job" sauvegarde entre-temps (__v passe à 1 en base).
    const otherJobDoc = store.load();
    (otherJobDoc as unknown as { other: string }).other = 'écrit par un autre job';
    await otherJobDoc.save();
    expect(store.getBacking().__v).toBe(1);

    // saveFieldWithRetry doit détecter le conflit sur staleDoc, recharger, réappliquer.
    const result = await saveFieldWithRetry(
      staleDoc,
      async () => store.load(),
      (d) => {
        (d as unknown as { tag: string }).tag = 'v2';
      },
    );

    expect(result).not.toBeNull();
    expect(store.getBacking().tag).toBe('v2');
    // Le champ écrit par l'autre job n'est PAS perdu (rechargement avant réapplication).
    expect(store.getBacking().other).toBe('écrit par un autre job');
    expect(store.getBacking().__v).toBe(2);
  });

  it('renvoie null si le rechargement ne retrouve plus le document (supprimé entre-temps)', async () => {
    const store = createFakeCourseStore({ fields: { title: 'Cours C' } });
    const staleDoc = store.load();
    await store.load().save(); // fait avancer __v pour provoquer un conflit

    const result = await saveFieldWithRetry(
      staleDoc,
      async () => null,
      () => undefined,
    );
    expect(result).toBeNull();
  });
});

/**
 * Test de charge léger (P120) : 5 « régénérations » concurrentes de la MÊME
 * leçon/cours, chacune appliquant sa propre mutation via saveFieldWithRetry.
 * Sans verrou optimiste + retry, des écritures concurrentes en "load → mutate →
 * save" perdraient silencieusement les mutations des autres (dernière écriture
 * gagne, aucune ne remonte d'erreur). Avec le retry, TOUTES les 5 mutations
 * doivent finir par être appliquées (état final cohérent, aucune perdue).
 */
describe('charge légère — 5 régénérations concurrentes de la même leçon', () => {
  it('applique les 5 mutations sans en perdre aucune (retry sur conflit)', async () => {
    const store = createFakeCourseStore({ fields: { regenerations: [] as string[] } });

    const attempts = Array.from({ length: 5 }, (_, i) => `régénération-${i + 1}`);

    const results = await Promise.all(
      attempts.map((label) =>
        saveFieldWithRetry(
          store.load(),
          async () => store.load(),
          (d) => {
            const doc = d as unknown as { regenerations: string[] };
            doc.regenerations = [...doc.regenerations, label];
          },
          { retries: 10, context: { label } },
        ),
      ),
    );

    // Aucun appel n'a échoué (toutes les tentatives ont fini par réussir).
    expect(results.every((r) => r !== null)).toBe(true);

    // État final cohérent : les 5 régénérations sont présentes, sans doublon ni perte.
    const finalRegenerations = store.getBacking().regenerations as string[];
    expect(finalRegenerations).toHaveLength(5);
    expect(new Set(finalRegenerations)).toEqual(new Set(attempts));

    // Le compteur de version reflète bien les 5 sauvegardes appliquées séquentiellement.
    expect(store.getBacking().__v).toBe(5);
  });
});
