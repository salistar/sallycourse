// Tests de gpu-autoscale.ts (P162) : décision de scale-up/down (pure), calcul
// de coût horaire vs fixe (pur), et provisioning mock-friendly sans credentials.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MAX_IDLE_MS,
  DEFAULT_QUEUE_THRESHOLD,
  HETZNER_GEX44_MONTHLY_USD,
  breakEvenHoursPerMonth,
  destroyGpuWorker,
  hourlyRateUsd,
  isRentalCheaperThanFixed,
  provisionGpuWorker,
  reapIdleGpuWorkers,
  rentalCostUsd,
  shouldScaleDown,
  shouldScaleUp,
  totalGpuQueueDepth,
  touchGpuWorker,
  type GpuWorkerHandle,
} from './gpu-autoscale.js';

describe('shouldScaleUp — décision pure de scale-up', () => {
  it('ne scale pas quand la profondeur est sous le seuil par défaut', () => {
    expect(shouldScaleUp(DEFAULT_QUEUE_THRESHOLD)).toBe(false);
    expect(shouldScaleUp(0)).toBe(false);
  });

  it('scale quand la profondeur dépasse strictement le seuil', () => {
    expect(shouldScaleUp(DEFAULT_QUEUE_THRESHOLD + 1)).toBe(true);
  });

  it('respecte un seuil personnalisé', () => {
    expect(shouldScaleUp(3, 2)).toBe(true);
    expect(shouldScaleUp(2, 2)).toBe(false);
  });
});

describe('shouldScaleDown — décision pure de scale-down', () => {
  it('ne descend pas si la queue est encore chargée, même très inactif', () => {
    expect(shouldScaleDown(10, DEFAULT_MAX_IDLE_MS + 1_000)).toBe(false);
  });

  it('ne descend pas si la queue est basse mais le worker vient de servir un job', () => {
    expect(shouldScaleDown(0, 1_000)).toBe(false);
  });

  it('descend si la queue est basse ET le worker inactif depuis assez longtemps', () => {
    expect(shouldScaleDown(0, DEFAULT_MAX_IDLE_MS)).toBe(true);
    expect(shouldScaleDown(1, DEFAULT_MAX_IDLE_MS + 60_000)).toBe(true);
  });

  it('respecte des seuils personnalisés', () => {
    expect(shouldScaleDown(5, 2_000, { threshold: 5, maxIdleMs: 1_000 })).toBe(true);
    expect(shouldScaleDown(6, 2_000, { threshold: 5, maxIdleMs: 1_000 })).toBe(false);
  });
});

describe('totalGpuQueueDepth — somme pure des queues GPU-dépendantes', () => {
  it('additionne les profondeurs fournies', () => {
    expect(totalGpuQueueDepth({ tts: 2, screenshot: 1, videoRender: 3 })).toBe(6);
  });

  it('ignore les valeurs négatives (défensif)', () => {
    expect(totalGpuQueueDepth({ tts: -5, screenshot: 4 })).toBe(4);
  });

  it('retourne 0 pour un objet vide', () => {
    expect(totalGpuQueueDepth({})).toBe(0);
  });
});

describe('hourlyRateUsd / rentalCostUsd — calcul pur du coût de location', () => {
  it('calcule le coût pour une durée donnée', () => {
    const rate = hourlyRateUsd('vast');
    expect(rentalCostUsd('vast', 10)).toBeCloseTo(rate * 10, 6);
  });

  it('clippe les durées négatives à zéro', () => {
    expect(rentalCostUsd('runpod', -5)).toBe(0);
  });
});

describe('isRentalCheaperThanFixed / breakEvenHoursPerMonth', () => {
  it('la location est moins chère pour un faible usage mensuel', () => {
    expect(isRentalCheaperThanFixed('vast', 50)).toBe(true);
  });

  it('le dédié devient moins cher au-delà du point de bascule', () => {
    const breakEven = breakEvenHoursPerMonth('vast');
    expect(isRentalCheaperThanFixed('vast', breakEven + 100)).toBe(false);
  });

  it('le point de bascule est cohérent avec le tarif horaire', () => {
    const breakEven = breakEvenHoursPerMonth('runpod', HETZNER_GEX44_MONTHLY_USD);
    expect(rentalCostUsd('runpod', breakEven)).toBeCloseTo(HETZNER_GEX44_MONTHLY_USD, 6);
  });
});

describe('provisionGpuWorker — mock-friendly sans credentials', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.GPU_AUTOSCALE_PROVIDER;
    delete process.env.RUNPOD_API_KEY;
    delete process.env.VASTAI_API_KEY;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
  });

  it('retourne un handle mock quand aucun provider n\'est configuré', async () => {
    const handle = await provisionGpuWorker({ now: () => 1_000 });
    expect(handle.provider).toBe('mock');
    expect(handle.startedAt).toBe(1_000);
    expect(handle.lastActiveAt).toBe(1_000);
  });

  it('retourne un handle mock quand le provider est configuré sans clé API', async () => {
    process.env.GPU_AUTOSCALE_PROVIDER = 'runpod';
    const handle = await provisionGpuWorker({ now: () => 2_000 });
    expect(handle.provider).toBe('mock');
  });

  it('appelle réellement l\'API quand provider + clé sont fournis', async () => {
    process.env.RUNPOD_API_KEY = 'test-key';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { podFindAndDeployOnDemand: { id: 'pod-123' } } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const handle = await provisionGpuWorker({ provider: 'runpod', now: () => 3_000 });
    expect(handle.provider).toBe('runpod');
    expect(handle.id).toBe('pod-123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retombe en mock si l\'appel réseau échoue', async () => {
    process.env.RUNPOD_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const handle = await provisionGpuWorker({ provider: 'runpod', now: () => 4_000 });
    expect(handle.provider).toBe('mock');
  });
});

describe('destroyGpuWorker — no-op sur handle mock', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ne fait aucun appel réseau pour un handle mock', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const handle: GpuWorkerHandle = { id: 'mock-1', provider: 'mock', gpuType: 'RTX4090', startedAt: 0, lastActiveAt: 0 };
    await destroyGpuWorker(handle);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('reapIdleGpuWorkers — reaper best-effort', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.RUNPOD_API_KEY;
  });

  it('conserve les workers actifs et détruit les inactifs', async () => {
    const now = 1_000_000;
    const active: GpuWorkerHandle = { id: 'active', provider: 'mock', gpuType: 'RTX4090', startedAt: 0, lastActiveAt: now - 1_000 };
    const idle: GpuWorkerHandle = { id: 'idle', provider: 'mock', gpuType: 'RTX4090', startedAt: 0, lastActiveAt: now - DEFAULT_MAX_IDLE_MS - 1 };

    const kept = await reapIdleGpuWorkers([active, idle], DEFAULT_MAX_IDLE_MS, now);
    expect(kept).toEqual([active]);
  });

  it('détruit réellement un handle non-mock inactif (best-effort, sans jeter)', async () => {
    process.env.RUNPOD_API_KEY = 'test-key';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    const now = 1_000_000;
    const idle: GpuWorkerHandle = { id: 'pod-x', provider: 'runpod', gpuType: 'RTX4090', startedAt: 0, lastActiveAt: 0 };
    const kept = await reapIdleGpuWorkers([idle], DEFAULT_MAX_IDLE_MS, now);
    expect(kept).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('touchGpuWorker', () => {
  it('met à jour lastActiveAt sans muter le handle original', () => {
    const handle: GpuWorkerHandle = { id: 'a', provider: 'mock', gpuType: 'RTX4090', startedAt: 0, lastActiveAt: 0 };
    const touched = touchGpuWorker(handle, 5_000);
    expect(touched.lastActiveAt).toBe(5_000);
    expect(handle.lastActiveAt).toBe(0);
  });
});
