import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Tests du rate limiter & anti-abus (P70). ioredis est mocké par un mini-Redis
// en mémoire qui implémente fidèlement les commandes réellement utilisées par
// rate-limit.ts (eval du script sliding-window, hmget/hincrby/hset/expire/del
// pour le lockout) — aucune connexion Redis réelle n'est nécessaire.

interface FakeHash {
  [field: string]: string;
}

/** Mini-Redis en mémoire suffisant pour exercer rate-limit.ts. */
class FakeRedis {
  zsets = new Map<string, Map<string, number>>();
  hashes = new Map<string, FakeHash>();
  ttls = new Map<string, number>();

  async eval(_script: string, _numKeys: number, key: string, ...args: string[]): Promise<number> {
    const [nowStr, windowMsStr, limitStr, member] = args;
    const now = Number(nowStr);
    const windowMs = Number(windowMsStr);
    const limit = Number(limitStr);

    let zset = this.zsets.get(key);
    if (!zset) {
      zset = new Map();
      this.zsets.set(key, zset);
    }
    // ZREMRANGEBYSCORE -inf (now - windowMs)
    for (const [m, score] of zset) {
      if (score <= now - windowMs) zset.delete(m);
    }
    const count = zset.size;
    if (count < limit) {
      zset.set(member!, now);
      return count + 1;
    }
    return -1;
  }

  async hmget(key: string, ...fields: string[]): Promise<(string | null)[]> {
    const hash = this.hashes.get(key) ?? {};
    return fields.map((f) => hash[f] ?? null);
  }

  async hincrby(key: string, field: string, delta: number): Promise<number> {
    const hash = this.hashes.get(key) ?? {};
    const next = Number(hash[field] ?? 0) + delta;
    hash[field] = String(next);
    this.hashes.set(key, hash);
    return next;
  }

  async hset(key: string, field: string, value: string | number): Promise<number> {
    const hash = this.hashes.get(key) ?? {};
    hash[field] = String(value);
    this.hashes.set(key, hash);
    return 1;
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.ttls.set(key, seconds);
    return 1;
  }

  async del(key: string): Promise<number> {
    this.hashes.delete(key);
    this.zsets.delete(key);
    return 1;
  }
}

const fakeRedisInstance = new FakeRedis();

vi.mock('ioredis', () => ({
  Redis: vi.fn(() => fakeRedisInstance),
}));

vi.mock('@sallycourse/shared', () => ({
  getConfig: () => ({ REDIS_URL: 'redis://fake' }),
}));

// Import APRÈS les mocks (hoisting vi.mock garanti par vitest).
const {
  rateLimit,
  checkLoginLockout,
  recordLoginFailure,
  clearLoginLockout,
  extractClientIp,
} = await import('./rate-limit');

describe('rateLimit — sliding window', () => {
  beforeEach(() => {
    fakeRedisInstance.zsets.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-11T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('autorise jusqu’à la limite puis bloque', async () => {
    const key = 'test:ip:1.2.3.4';
    const opts = { limit: 3, windowSec: 60 };

    const r1 = await rateLimit(key, opts);
    const r2 = await rateLimit(key, opts);
    const r3 = await rateLimit(key, opts);
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);

    const r4 = await rateLimit(key, opts);
    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
  });

  it('remaining décroît correctement à chaque requête', async () => {
    const key = 'test:ip:decroit';
    const opts = { limit: 5, windowSec: 60 };

    const r1 = await rateLimit(key, opts);
    expect(r1.remaining).toBe(4);
    const r2 = await rateLimit(key, opts);
    expect(r2.remaining).toBe(3);
  });

  it('réautorise après expiration de la fenêtre glissante', async () => {
    const key = 'test:ip:reset';
    const opts = { limit: 1, windowSec: 60 };

    const r1 = await rateLimit(key, opts);
    expect(r1.allowed).toBe(true);

    const r2 = await rateLimit(key, opts);
    expect(r2.allowed).toBe(false);

    // Avance le temps au-delà de la fenêtre (60s + marge).
    vi.setSystemTime(new Date('2026-07-11T10:01:01.000Z'));

    const r3 = await rateLimit(key, opts);
    expect(r3.allowed).toBe(true);
  });

  it('des clés différentes ont des compteurs indépendants', async () => {
    const opts = { limit: 1, windowSec: 60 };
    const rA = await rateLimit('test:ip:aaa', opts);
    const rB = await rateLimit('test:ip:bbb', opts);
    expect(rA.allowed).toBe(true);
    expect(rB.allowed).toBe(true);
  });
});

describe('lockout progressif (anti-bruteforce login)', () => {
  beforeEach(() => {
    fakeRedisInstance.hashes.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-11T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aucun échec préalable → non verrouillé', async () => {
    const state = await checkLoginLockout('1.2.3.4:new@example.com');
    expect(state.locked).toBe(false);
    expect(state.attempts).toBe(0);
  });

  it('sous le premier palier (< 3 échecs) → pas de verrouillage', async () => {
    const key = '1.2.3.4:user@example.com';
    await recordLoginFailure(key);
    await recordLoginFailure(key);
    const state = await checkLoginLockout(key);
    expect(state.locked).toBe(false);
    expect(state.attempts).toBe(2);
  });

  it('délai croissant selon le palier atteint (3 → 30s, 5 → 120s)', async () => {
    const key = '1.2.3.4:bruteforce@example.com';
    for (let i = 0; i < 3; i++) await recordLoginFailure(key);

    const afterThree = await checkLoginLockout(key);
    expect(afterThree.locked).toBe(true);
    expect(afterThree.retryAfterSec).toBe(30);

    for (let i = 0; i < 2; i++) await recordLoginFailure(key);
    const afterFive = await checkLoginLockout(key);
    expect(afterFive.locked).toBe(true);
    expect(afterFive.retryAfterSec).toBe(120);
  });

  it('le verrouillage se lève après écoulement du délai du palier', async () => {
    const key = '1.2.3.4:timeout@example.com';
    for (let i = 0; i < 3; i++) await recordLoginFailure(key);

    const locked = await checkLoginLockout(key);
    expect(locked.locked).toBe(true);

    // Avance au-delà du délai de 30s du palier "3 échecs".
    vi.setSystemTime(new Date('2026-07-11T10:00:31.000Z'));
    const unlocked = await checkLoginLockout(key);
    expect(unlocked.locked).toBe(false);
  });

  it('clearLoginLockout remet le compteur à zéro (connexion réussie)', async () => {
    const key = '1.2.3.4:success@example.com';
    await recordLoginFailure(key);
    await recordLoginFailure(key);
    await recordLoginFailure(key);
    expect((await checkLoginLockout(key)).locked).toBe(true);

    await clearLoginLockout(key);
    const state = await checkLoginLockout(key);
    expect(state.locked).toBe(false);
    expect(state.attempts).toBe(0);
  });
});

describe('extractClientIp', () => {
  it('lit x-forwarded-for et prend la première IP', () => {
    const request = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '203.0.113.5, 70.41.3.18' },
    });
    expect(extractClientIp(request)).toBe('203.0.113.5');
  });

  it('retombe sur x-real-ip si x-forwarded-for absent', () => {
    const request = new Request('http://localhost', { headers: { 'x-real-ip': '198.51.100.7' } });
    expect(extractClientIp(request)).toBe('198.51.100.7');
  });

  it('retourne "unknown" si aucun en-tête présent', () => {
    const request = new Request('http://localhost');
    expect(extractClientIp(request)).toBe('unknown');
  });
});
