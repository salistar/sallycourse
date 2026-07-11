// Vérifie que chaque groupe de queues (P71 — scaling) n'enregistre QUE son
// sous-ensemble : mock de createQueue/registerWorker + de tous les processors
// (évite d'importer réellement mongoose/playwright/ffmpeg via les modules réels).
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../queues/index.js', () => ({
  createQueue: vi.fn(),
  registerWorker: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../processors/outline-generation.js', () => ({ processOutlineGeneration: vi.fn() }));
vi.mock('../processors/content-generation.js', () => ({ processContentGeneration: vi.fn() }));
vi.mock('../processors/tts-generation.js', () => ({ processTtsGeneration: vi.fn() }));
vi.mock('../processors/subtitle-generation.js', () => ({ processSubtitleGeneration: vi.fn() }));
vi.mock('../processors/screenshot-capture.js', () => ({ processScreenshotCapture: vi.fn() }));
vi.mock('../processors/video-render.js', () => ({ processVideoRender: vi.fn() }));
vi.mock('../processors/packaging.js', () => ({ processPackaging: vi.fn() }));
vi.mock('../processors/deployment.js', () => ({ processDeployment: vi.fn() }));

const { createQueue, registerWorker } = await import('../queues/index.js');
const { registerCpuQueues, registerApiQueues, registerBrowserQueues } = await import('./register-groups.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('registerCpuQueues', () => {
  it("n'enregistre que videoRender + packaging + screenshot", () => {
    const names = registerCpuQueues();
    expect(names).toEqual(['video-render', 'packaging', 'screenshot-capture']);
    expect(registerWorker).toHaveBeenCalledTimes(3);
    const registered = vi.mocked(registerWorker).mock.calls.map((c) => c[0]);
    expect(registered.sort()).toEqual(['packaging', 'screenshot-capture', 'video-render'].sort());
    expect(createQueue).toHaveBeenCalledTimes(3);
    // Ne touche pas aux queues des autres groupes.
    expect(registered).not.toContain('outline-generation');
    expect(registered).not.toContain('content-generation');
    expect(registered).not.toContain('tts-generation');
    expect(registered).not.toContain('subtitle-generation');
    expect(registered).not.toContain('deployment');
  });
});

describe('registerApiQueues', () => {
  it("n'enregistre que outline + content + tts + subtitle", () => {
    const names = registerApiQueues();
    expect(names).toEqual(['outline-generation', 'content-generation', 'tts-generation', 'subtitle-generation']);
    expect(registerWorker).toHaveBeenCalledTimes(4);
    const registered = vi.mocked(registerWorker).mock.calls.map((c) => c[0]);
    expect(registered.sort()).toEqual(
      ['outline-generation', 'content-generation', 'tts-generation', 'subtitle-generation'].sort(),
    );
    expect(createQueue).toHaveBeenCalledTimes(4);
    // Ne touche pas aux queues des autres groupes.
    expect(registered).not.toContain('video-render');
    expect(registered).not.toContain('packaging');
    expect(registered).not.toContain('screenshot-capture');
    expect(registered).not.toContain('deployment');
  });
});

describe('registerBrowserQueues', () => {
  it("n'enregistre que deployment", () => {
    const names = registerBrowserQueues();
    expect(names).toEqual(['deployment']);
    expect(registerWorker).toHaveBeenCalledTimes(1);
    expect(vi.mocked(registerWorker).mock.calls[0]?.[0]).toBe('deployment');
    expect(createQueue).toHaveBeenCalledTimes(1);
    expect(createQueue).toHaveBeenCalledWith('deployment');
  });
});
