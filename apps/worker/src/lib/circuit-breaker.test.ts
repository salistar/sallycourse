// Tests du circuit breaker générique (Prompt 77) : transitions
// closed → open → half-open → closed, avec de fake timers pour contrôler
// le délai de reset sans attendre en temps réel.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Redis mocké (mini-store en mémoire) : persistSnapshot() ne doit jamais
// ouvrir de vraie connexion pendant les tests (best-effort, fire-and-forget).
const fakeRedisStore = vi.hoisted(() => new Map<string, string>());
vi.mock('../queues/connection.js', () => ({
  getRedisConnection: () => ({
    set: async (key: string, value: string) => {
      fakeRedisStore.set(key, value);
      return 'OK';
    },
  }),
}));

import {
  CircuitBreaker,
  CircuitOpenError,
  listCircuitBreakers,
  resetCircuitBreakerRegistryForTests,
} from './circuit-breaker.js';

beforeEach(() => {
  vi.useFakeTimers();
  resetCircuitBreakerRegistryForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

const fail = async (): Promise<never> => {
  throw new Error('boom');
};
const ok = async (): Promise<string> => 'ok';

describe('CircuitBreaker — transitions', () => {
  it('reste closed tant que le seuil d’échecs n’est pas atteint', async () => {
    const breaker = new CircuitBreaker('test-a', { failureThreshold: 3, resetTimeoutMs: 1000 });

    await expect(breaker.execute(fail)).rejects.toThrow('boom');
    await expect(breaker.execute(fail)).rejects.toThrow('boom');
    expect(breaker.snapshot().state).toBe('closed');
    expect(breaker.snapshot().failureCount).toBe(2);
  });

  it('passe closed → open après avoir atteint le seuil d’échecs', async () => {
    const breaker = new CircuitBreaker('test-b', { failureThreshold: 2, resetTimeoutMs: 5000 });

    await expect(breaker.execute(fail)).rejects.toThrow('boom');
    await expect(breaker.execute(fail)).rejects.toThrow('boom');

    const snap = breaker.snapshot();
    expect(snap.state).toBe('open');
    expect(snap.failureCount).toBe(2);
    expect(snap.lastError).toBe('boom');
    expect(snap.nextAttemptAt).not.toBeNull();
  });

  it('rejette immédiatement (sans exécuter fn) tant que le circuit est open', async () => {
    const breaker = new CircuitBreaker('test-c', { failureThreshold: 1, resetTimeoutMs: 5000 });
    await expect(breaker.execute(fail)).rejects.toThrow('boom');
    expect(breaker.snapshot().state).toBe('open');

    const spy = vi.fn(ok);
    await expect(breaker.execute(spy)).rejects.toThrow(CircuitOpenError);
    expect(spy).not.toHaveBeenCalled();
  });

  it('passe open → half-open après resetTimeoutMs, puis half-open → closed sur succès', async () => {
    const breaker = new CircuitBreaker('test-d', { failureThreshold: 1, resetTimeoutMs: 5000 });
    await expect(breaker.execute(fail)).rejects.toThrow('boom');
    expect(breaker.snapshot().state).toBe('open');

    vi.advanceTimersByTime(5001);

    const result = await breaker.execute(ok);
    expect(result).toBe('ok');

    const snap = breaker.snapshot();
    expect(snap.state).toBe('closed');
    expect(snap.failureCount).toBe(0);
    expect(snap.nextAttemptAt).toBeNull();
  });

  it('passe half-open → open si l’essai unique échoue encore', async () => {
    const breaker = new CircuitBreaker('test-e', { failureThreshold: 1, resetTimeoutMs: 5000 });
    await expect(breaker.execute(fail)).rejects.toThrow('boom');
    vi.advanceTimersByTime(5001);

    // Essai unique en half-open : échoue à nouveau → ré-ouverture immédiate.
    await expect(breaker.execute(fail)).rejects.toThrow('boom');

    const snap = breaker.snapshot();
    expect(snap.state).toBe('open');
    expect(snap.nextAttemptAt).not.toBeNull();
  });

  it('un nouvel essai après re-ouverture attend de nouveau le délai complet', async () => {
    const breaker = new CircuitBreaker('test-f', { failureThreshold: 1, resetTimeoutMs: 1000 });
    await expect(breaker.execute(fail)).rejects.toThrow('boom');
    vi.advanceTimersByTime(1001);
    await expect(breaker.execute(fail)).rejects.toThrow('boom'); // half-open → open
    expect(breaker.snapshot().state).toBe('open');

    // Toujours rejeté avant le nouveau délai.
    vi.advanceTimersByTime(500);
    await expect(breaker.execute(ok)).rejects.toThrow(CircuitOpenError);

    // Après le nouveau délai complet : half-open puis succès → closed.
    vi.advanceTimersByTime(501);
    await expect(breaker.execute(ok)).resolves.toBe('ok');
    expect(breaker.snapshot().state).toBe('closed');
  });
});

describe('listCircuitBreakers — registre global', () => {
  it('liste tous les breakers créés, triés par nom', async () => {
    new CircuitBreaker('zebra', { failureThreshold: 1, resetTimeoutMs: 1000 });
    new CircuitBreaker('alpha', { failureThreshold: 1, resetTimeoutMs: 1000 });

    const names = listCircuitBreakers().map((b) => b.name);
    expect(names).toEqual(['alpha', 'zebra']);
  });

  it('reflète l’état courant de chaque breaker (closed par défaut)', async () => {
    const breaker = new CircuitBreaker('solo', { failureThreshold: 1, resetTimeoutMs: 1000 });
    expect(listCircuitBreakers().find((b) => b.name === 'solo')?.state).toBe('closed');

    await expect(breaker.execute(fail)).rejects.toThrow('boom');
    expect(listCircuitBreakers().find((b) => b.name === 'solo')?.state).toBe('open');
  });
});
