// Tests de detectQueueBlocked (pur) et de notifyOps (webhook optionnel) — P75.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectQueueBlocked, notifyOps, DEFAULT_QUEUE_BLOCKED_THRESHOLD_MS } from './alerts.js';

describe('detectQueueBlocked — détection pure de blocage de queue', () => {
  it('ne signale rien quand la queue est vide', () => {
    const result = detectQueueBlocked([], 1_000, 100_000);
    expect(result).toEqual({ blocked: false, oldestAgeMs: 0 });
  });

  it('ne signale pas de blocage quand le job le plus ancien est sous le seuil', () => {
    const now = 100_000;
    const jobs = [
      { id: 'a', timestamp: now - 500 },
      { id: 'b', timestamp: now - 200 },
    ];
    const result = detectQueueBlocked(jobs, 1_000, now);
    expect(result.blocked).toBe(false);
    expect(result.oldestAgeMs).toBe(500);
    expect(result.oldestJobId).toBe('a');
  });

  it('signale un blocage quand le job le plus ancien dépasse le seuil', () => {
    const now = 100_000;
    const jobs = [
      { id: 'old', timestamp: now - 5_000 },
      { id: 'new', timestamp: now - 100 },
    ];
    const result = detectQueueBlocked(jobs, 1_000, now);
    expect(result.blocked).toBe(true);
    expect(result.oldestAgeMs).toBe(5_000);
    expect(result.oldestJobId).toBe('old');
  });

  it('identifie correctement le plus ancien même si la liste n\'est pas triée', () => {
    const now = 100_000;
    const jobs = [
      { id: 'mid', timestamp: now - 2_000 },
      { id: 'oldest', timestamp: now - 9_000 },
      { id: 'newest', timestamp: now - 100 },
    ];
    const result = detectQueueBlocked(jobs, 1_000, now);
    expect(result.oldestJobId).toBe('oldest');
    expect(result.oldestAgeMs).toBe(9_000);
  });

  it('seuil par défaut exporté vaut 30 minutes', () => {
    expect(DEFAULT_QUEUE_BLOCKED_THRESHOLD_MS).toBe(30 * 60 * 1_000);
  });
});

describe('notifyOps — log toujours, webhook seulement si configuré', () => {
  const originalFetch = globalThis.fetch;
  const originalWebhook = process.env.OPS_WEBHOOK_URL;

  beforeEach(() => {
    delete process.env.OPS_WEBHOOK_URL;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalWebhook === undefined) delete process.env.OPS_WEBHOOK_URL;
    else process.env.OPS_WEBHOOK_URL = originalWebhook;
    vi.restoreAllMocks();
  });

  it('ne fait aucun appel réseau sans OPS_WEBHOOK_URL (no-op silencieux)', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await expect(notifyOps('test sans webhook', 'warning')).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('POST le webhook avec le message quand OPS_WEBHOOK_URL est configuré', async () => {
    process.env.OPS_WEBHOOK_URL = 'https://example.test/webhook';
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await notifyOps('job en échec répété', 'critical');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.test/webhook');
    const body = JSON.parse(options.body as string) as { text: string; severity: string; message: string };
    expect(body.severity).toBe('critical');
    expect(body.message).toBe('job en échec répété');
    expect(body.text).toContain('job en échec répété');
  });

  it('n\'échoue jamais même si le webhook rejette (best-effort)', async () => {
    process.env.OPS_WEBHOOK_URL = 'https://example.test/webhook';
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('réseau indisponible')) as unknown as typeof fetch;

    await expect(notifyOps('test résilience', 'warning')).resolves.toBeUndefined();
  });
});
