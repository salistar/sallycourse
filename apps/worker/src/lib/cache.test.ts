// Tests de getOrCompute (hit/miss/verrou anti-stampede) et du hash déterministe
// des clés de cache (Prompt 72). Redis est remplacé par un mini-Redis en
// mémoire suffisant pour exercer get/set(NX/PX/EX)/del/exists/incr — aucune
// connexion réelle nécessaire.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Entry {
  value: string;
  expiresAt?: number;
}

/** Mini-Redis en mémoire : suffisant pour getOrCompute + statistiques. */
class FakeRedis {
  store = new Map<string, Entry>();

  private isExpired(entry: Entry): boolean {
    return entry.expiresAt !== undefined && Date.now() >= entry.expiresAt;
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (this.isExpired(entry)) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  // Signature volontairement permissive (variadic) : reflète l'API ioredis
  // réelle (SET key value [PX ms|EX s] [NX]) utilisée par cache.ts.
  async set(key: string, value: string, ...args: string[]): Promise<'OK' | null> {
    let expiresAt: number | undefined;
    let nx = false;
    for (let i = 0; i < args.length; i++) {
      const token = args[i]!.toUpperCase();
      if (token === 'PX') expiresAt = Date.now() + Number(args[++i]);
      else if (token === 'EX') expiresAt = Date.now() + Number(args[++i]) * 1000;
      else if (token === 'NX') nx = true;
    }
    if (nx) {
      const existing = this.store.get(key);
      if (existing && !this.isExpired(existing)) return null;
    }
    this.store.set(key, { value, expiresAt });
    return 'OK';
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  async exists(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return 0;
    if (this.isExpired(entry)) {
      this.store.delete(key);
      return 0;
    }
    return 1;
  }

  async incr(key: string): Promise<number> {
    const current = Number((await this.get(key)) ?? '0');
    const next = current + 1;
    this.store.set(key, { value: String(next) });
    return next;
  }
}

const fakeRedis = new FakeRedis();

vi.mock('../queues/connection.js', () => ({
  getRedisConnection: () => fakeRedis,
}));
vi.mock('../queues/index.js', () => ({
  logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
}));

import { getOrCompute, hashCacheKey, readCacheStats, resetCacheStatsForTests } from './cache.js';

beforeEach(async () => {
  fakeRedis.store.clear();
  await resetCacheStatsForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('hashCacheKey', () => {
  it('est déterministe : mêmes entrées → même hash', () => {
    expect(hashCacheKey('system', 'user', 'model')).toBe(hashCacheKey('system', 'user', 'model'));
  });

  it('distingue des entrées différentes', () => {
    expect(hashCacheKey('system', 'user', 'model')).not.toBe(hashCacheKey('system', 'user2', 'model'));
    expect(hashCacheKey('a', 'bc', 'd')).not.toBe(hashCacheKey('ab', 'c', 'd'));
  });

  it('produit un hex sha256 (64 caractères)', () => {
    expect(hashCacheKey('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('getOrCompute', () => {
  it('miss : appelle compute() et met en cache le résultat', async () => {
    const compute = vi.fn().mockResolvedValue({ value: 42 });
    const result = await getOrCompute('k1', 60, compute);
    expect(result).toEqual({ value: 42 });
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('hit : ne rappelle pas compute() si la valeur est déjà en cache', async () => {
    const compute = vi.fn().mockResolvedValue({ value: 1 });
    await getOrCompute('k2', 60, compute);
    const result = await getOrCompute('k2', 60, compute);
    expect(result).toEqual({ value: 1 });
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('incrémente les statistiques hit/miss quand un namespace est fourni', async () => {
    const compute = vi.fn().mockResolvedValue('v');
    await getOrCompute('k3', 60, compute, 'claude'); // miss
    await getOrCompute('k3', 60, compute, 'claude'); // hit
    const stats = await readCacheStats();
    const claude = stats.find((s) => s.namespace === 'claude');
    expect(claude).toEqual({ namespace: 'claude', hits: 1, misses: 1 });
  });

  it('verrou anti-stampede : un appel concurrent réutilise le résultat au lieu de recalculer', async () => {
    let resolveCompute: (v: string) => void;
    const slow = new Promise<string>((resolve) => {
      resolveCompute = resolve;
    });
    const compute = vi.fn().mockReturnValue(slow);

    // Premier appel : pose le verrou, reste en attente de `slow`.
    const first = getOrCompute('k4', 60, compute);

    // Le verrou est posé avant que le premier compute() ne soit résolu : un
    // second appelant qui arrive maintenant doit attendre plutôt que recalculer.
    await Promise.resolve(); // laisse getOrCompute poser le verrou (microtask)
    const second = getOrCompute('k4', 60, () => Promise.resolve('ne-devrait-jamais-être-appelé'));

    resolveCompute!('valeur-calculee');
    const [r1, r2] = await Promise.all([first, second]);

    expect(r1).toBe('valeur-calculee');
    expect(r2).toBe('valeur-calculee');
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('respecte le TTL : la clé expire et compute() est rappelé', async () => {
    vi.useFakeTimers();
    const compute = vi.fn().mockResolvedValue('v1').mockResolvedValueOnce('v1').mockResolvedValueOnce('v2');
    await getOrCompute('k5', 1, compute); // TTL 1s
    vi.advanceTimersByTime(1100);
    const result = await getOrCompute('k5', 1, compute);
    expect(result).toBe('v2');
    expect(compute).toHaveBeenCalledTimes(2);
  });
});

describe('getOrCompute — Redis indisponible (chaos, Prompt 128)', () => {
  it('bypass propre si la LECTURE du cache échoue : compute() est appelé, aucune exception ne remonte', async () => {
    const getSpy = vi.spyOn(fakeRedis, 'get').mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const compute = vi.fn().mockResolvedValue({ value: 'depuis-compute' });

    const result = await getOrCompute('k-redis-down-read', 60, compute, 'claude');

    expect(result).toEqual({ value: 'depuis-compute' });
    expect(compute).toHaveBeenCalledTimes(1);
    getSpy.mockRestore();
  });

  it('bypass propre si la POSE DU VERROU échoue (miss puis SET NX en panne) : calcule sans verrou, ne plante pas', async () => {
    const setSpy = vi.spyOn(fakeRedis, 'set').mockRejectedValueOnce(new Error('Redis indisponible'));
    const compute = vi.fn().mockResolvedValue('resultat-sans-verrou');

    const result = await getOrCompute('k-redis-down-lock', 60, compute);

    expect(result).toBe('resultat-sans-verrou');
    expect(compute).toHaveBeenCalledTimes(1);
    setSpy.mockRestore();
  });

  it('Redis totalement down du début à la fin (get + set échouent) : ne jette jamais, retourne le résultat de compute()', async () => {
    vi.spyOn(fakeRedis, 'get').mockRejectedValue(new Error('connexion refusée'));
    vi.spyOn(fakeRedis, 'set').mockRejectedValue(new Error('connexion refusée'));
    const compute = vi.fn().mockResolvedValue('valeur-de-repli');

    await expect(getOrCompute('k-redis-down-total', 60, compute)).resolves.toBe('valeur-de-repli');
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('un compute() qui échoue APRÈS un bypass de lecture propage bien son erreur (pas de faux succès)', async () => {
    vi.spyOn(fakeRedis, 'get').mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const compute = vi.fn().mockRejectedValue(new Error('échec métier réel'));

    await expect(getOrCompute('k-redis-down-compute-fails', 60, compute)).rejects.toThrow('échec métier réel');
  });
});
