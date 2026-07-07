// Tests de l'adapter YouTube en mode MOCK : aucun appel réseau (fetch échouerait),
// URLs fictives déterministes, flow complet et registre.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { YouTubeAdapter } from './youtube.js';
import { getAdapter, hasAdapter } from '../registry.js';
import type { DeployContext } from '../types.js';
import type { ILesson, ISection } from '../../shared.js';

// Importe le module pour déclencher l'enregistrement (effet de bord).
import './youtube.js';

/** Fabrique un DeployContext minimal en mode mock (pas de réseau, pas de Mongo). */
function makeCtx(overrides: Partial<DeployContext> = {}): DeployContext {
  const deployment = {
    checkpoint: { lessonIndex: 0, step: '' },
    logs: [] as unknown[],
    externalUrl: undefined as string | undefined,
    save: vi.fn().mockResolvedValue(undefined),
  };
  const sections = [{ _id: 's1', order: 0, title: 'Section 1', courseId: 'c1' }] as unknown as ISection[];
  const lessons = [
    { _id: 'l1', sectionId: 's1', order: 0, title: 'Leçon 1', durationMin: 5, assets: {} },
    { _id: 'l2', sectionId: 's1', order: 1, title: 'Leçon 2', durationMin: 8, assets: {} },
  ] as unknown as ILesson[];
  return {
    platform: 'youtube',
    mode: 'auto',
    course: { _id: 'c1', title: 'Mon cours', locale: 'fr' } as unknown as DeployContext['course'],
    sections,
    lessons,
    credentials: {},
    checkpoint: deployment.checkpoint,
    publishProgress: vi.fn().mockResolvedValue(undefined),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as DeployContext['logger'],
    mock: true,
    deployment: deployment as unknown as DeployContext['deployment'],
    ...overrides,
  };
}

describe('YouTubeAdapter (mock)', () => {
  const fetchSpy = vi.fn(() => Promise.reject(new Error('réseau interdit en mock')));
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    // En mock, aucun fetch ne doit partir : on le remplace par un rejet dur.
    fetchSpy.mockClear();
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("s'enregistre dans le registre sous 'youtube'", () => {
    expect(hasAdapter('youtube')).toBe(true);
    expect(getAdapter('youtube').platform).toBe('youtube');
  });

  it('déroule le flow complet sans aucun appel réseau', async () => {
    const adapter = new YouTubeAdapter();
    const ctx = makeCtx();

    await adapter.authenticate(ctx);
    const { externalId } = await adapter.createCourse(ctx);
    expect(externalId).toMatch(/^mock-playlist-/);
    expect(ctx.externalId).toBe(externalId);

    await adapter.uploadLesson(ctx, ctx.lessons[0]!, 0);
    await adapter.uploadLesson(ctx, ctx.lessons[1]!, 1);
    await adapter.setLandingPage(ctx);
    await adapter.submitForReview(ctx);
    const status = await adapter.getStatus(ctx);

    expect(status.status).toBe('published');
    expect(status.externalUrl).toContain('youtube.com/playlist?list=mock-playlist-');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('produit des URLs de vidéo déterministes (même index → même id)', async () => {
    const adapter = new YouTubeAdapter();
    const ctx = makeCtx();
    await adapter.authenticate(ctx);
    await adapter.createCourse(ctx);
    await adapter.uploadLesson(ctx, ctx.lessons[0]!, 0);
    const firstLog = String(ctx.deployment.logs.at(-1));
    // Rejoue le même upload sur un contexte identique → même id de vidéo.
    const ctx2 = makeCtx();
    await adapter.authenticate(ctx2);
    await adapter.createCourse(ctx2);
    await adapter.uploadLesson(ctx2, ctx2.lessons[0]!, 0);
    expect(String(ctx2.deployment.logs.at(-1))).toBe(firstLog);
  });

  it('exige authenticate() avant createCourse', async () => {
    const adapter = new YouTubeAdapter();
    const ctx = makeCtx();
    await expect(adapter.createCourse(ctx)).rejects.toThrow(/authenticate/);
  });

  it('isole les sessions entre déploiements concurrents (WeakMap)', async () => {
    const adapter = new YouTubeAdapter();
    const ctxA = makeCtx({ credentials: { privacy: 'public' } });
    const ctxB = makeCtx({ credentials: { privacy: 'unlisted' } });
    await adapter.authenticate(ctxA);
    await adapter.authenticate(ctxB);
    // Chaque contexte garde sa propre session : createCourse fonctionne pour les deux.
    await expect(adapter.createCourse(ctxA)).resolves.toBeDefined();
    await expect(adapter.createCourse(ctxB)).resolves.toBeDefined();
  });
});
