// Tests de guardBrowserSession (P126) : fermeture forcée après timeout, et
// absence de fermeture si dispose() est appelé avant l'échéance. Fake timers
// (aucun vrai navigateur — context.close est un mock).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardBrowserSession, DEFAULT_SESSION_TIMEOUT_MS } from './browser-session-guard.js';
import type { BrowserContext } from 'playwright';

function fakeContext(): { close: ReturnType<typeof vi.fn> } {
  return { close: vi.fn().mockResolvedValue(undefined) };
}

describe('guardBrowserSession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ferme le contexte de force une fois le délai dépassé', async () => {
    const ctx = fakeContext();
    guardBrowserSession(ctx as unknown as BrowserContext, 'test.session', 1_000);

    expect(ctx.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(ctx.close).toHaveBeenCalledTimes(1);
  });

  it('n\'appelle jamais close si dispose() est invoqué avant le délai', async () => {
    const ctx = fakeContext();
    const guard = guardBrowserSession(ctx as unknown as BrowserContext, 'test.session', 1_000);

    guard.dispose();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(ctx.close).not.toHaveBeenCalled();
  });

  it('utilise DEFAULT_SESSION_TIMEOUT_MS (10 minutes) quand aucun délai n\'est fourni', async () => {
    const ctx = fakeContext();
    guardBrowserSession(ctx as unknown as BrowserContext, 'test.session');

    await vi.advanceTimersByTimeAsync(DEFAULT_SESSION_TIMEOUT_MS - 1);
    expect(ctx.close).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(ctx.close).toHaveBeenCalledTimes(1);
  });

  it('ne jette pas si context.close() échoue (best-effort)', async () => {
    const ctx = { close: vi.fn().mockRejectedValue(new Error('déjà fermé')) };
    guardBrowserSession(ctx as unknown as BrowserContext, 'test.session', 100);

    await vi.advanceTimersByTimeAsync(100);
    // Laisse la microtask du .catch() s'exécuter sans lever d'exception non gérée.
    await vi.runAllTicks?.();
    expect(ctx.close).toHaveBeenCalledTimes(1);
  });
});
