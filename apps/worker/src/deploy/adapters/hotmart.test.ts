// Tests de l'adapter Hotmart (Prompt 103) : helpers purs (requête OAuth2,
// payloads API), flow complet en mode MOCK (aucun appel réseau), reprise via
// checkpoint (createCourse idempotent quand externalId déjà connu).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILesson, ISection } from '../../shared.js';
import { getAdapter, hasAdapter } from '../registry.js';
import type { DeployContext } from '../types.js';
import {
  buildHotmartModulePayload,
  buildHotmartPagePayload,
  buildHotmartProductUpdatePayload,
  buildHotmartTokenRequest,
  hotmartAuthHeaders,
  hotmartProductUrl,
  HotmartAdapter,
  HOTMART_PLATFORM,
} from './hotmart.js';
// Importe le module pour déclencher l'enregistrement (effet de bord).
import './hotmart.js';

/* ------------------------------------------------------------------ */
/* Helpers purs                                                        */
/* ------------------------------------------------------------------ */

describe('buildHotmartTokenRequest', () => {
  it('construit la requête OAuth2 client_credentials en form-urlencoded', () => {
    const { url, body } = buildHotmartTokenRequest('cid', 'csecret');
    expect(url).toBe('https://api-sec-vlc.hotmart.com/security/oauth/token');
    expect(body).toContain('grant_type=client_credentials');
    expect(body).toContain('client_id=cid');
    expect(body).toContain('client_secret=csecret');
  });
});

describe('hotmartAuthHeaders', () => {
  it('renvoie l’en-tête Authorization Bearer', () => {
    expect(hotmartAuthHeaders('tok123')).toEqual({
      Authorization: 'Bearer tok123',
      'Content-Type': 'application/json',
    });
  });
});

describe('buildHotmartModulePayload', () => {
  it('construit le module avec le titre et statut publié', () => {
    expect(buildHotmartModulePayload('Mon Cours')).toEqual({
      name: 'Mon Cours',
      status: 'PUBLISHED',
    });
  });
  it('replie sur "Cours" si le titre est vide', () => {
    expect(buildHotmartModulePayload('   ')).toEqual({ name: 'Cours', status: 'PUBLISHED' });
  });
});

describe('buildHotmartPagePayload', () => {
  const lesson = { title: 'Leçon 1', summary: 'Résumé' } as unknown as ILesson;

  it('construit la page sans vidéo', () => {
    expect(buildHotmartPagePayload(lesson)).toEqual({
      name: 'Leçon 1',
      content: 'Résumé',
    });
  });
  it('ajoute video_url quand fourni', () => {
    expect(buildHotmartPagePayload(lesson, 'https://cdn/video.mp4')).toEqual({
      name: 'Leçon 1',
      content: 'Résumé',
      video_url: 'https://cdn/video.mp4',
    });
  });
});

describe('buildHotmartProductUpdatePayload', () => {
  it('construit description + prix en BRL par défaut', () => {
    expect(buildHotmartProductUpdatePayload('Desc', 197)).toEqual({
      description: 'Desc',
      price: { value: 197, currency_code: 'BRL' },
    });
  });
  it('accepte une devise explicite', () => {
    expect(buildHotmartProductUpdatePayload('Desc', 50, 'USD')).toEqual({
      description: 'Desc',
      price: { value: 50, currency_code: 'USD' },
    });
  });
});

describe('hotmartProductUrl', () => {
  it('construit l’URL publique du produit', () => {
    expect(hotmartProductUrl('abc123')).toBe('https://hotmart.com/product/abc123');
  });
});

/* ------------------------------------------------------------------ */
/* Flow complet en mode MOCK                                           */
/* ------------------------------------------------------------------ */

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
    { _id: 'l1', sectionId: 's1', order: 0, title: 'Leçon 1', type: 'video', durationMin: 5, assets: {} },
    { _id: 'l2', sectionId: 's1', order: 1, title: 'Leçon 2', type: 'article', durationMin: 8, assets: {} },
  ] as unknown as ILesson[];
  return {
    platform: HOTMART_PLATFORM,
    mode: 'auto',
    course: { _id: 'c1', title: 'Mon cours', locale: 'pt', difficulty: 'iniciante' } as unknown as DeployContext['course'],
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

describe('HotmartAdapter (mock)', () => {
  const fetchSpy = vi.fn(() => Promise.reject(new Error('réseau interdit en mock')));
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    fetchSpy.mockClear();
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("s'enregistre dans le registre sous 'hotmart'", () => {
    expect(hasAdapter('hotmart')).toBe(true);
    expect(getAdapter('hotmart').platform).toBe('hotmart');
  });

  it('déclare ses capacités (auto/manual, sans navigateur)', () => {
    const adapter = new HotmartAdapter();
    expect(adapter.capabilities).toEqual({ modes: ['auto', 'manual'], needsBrowser: false });
  });

  it('déroule le flow complet sans aucun appel réseau', async () => {
    const adapter = new HotmartAdapter();
    const ctx = makeCtx();

    await adapter.authenticate(ctx);
    const { externalId } = await adapter.createCourse(ctx);
    expect(externalId).toMatch(/^hotmart_mock_/);
    ctx.externalId = externalId;

    for (let i = 0; i < ctx.lessons.length; i += 1) {
      await adapter.uploadLesson(ctx, ctx.lessons[i]!, i);
    }
    await adapter.setLandingPage(ctx);
    await adapter.submitForReview(ctx);
    const status = await adapter.getStatus(ctx);

    expect(status.status).toBe('published');
    expect(status.externalUrl).toBe(`https://hotmart.com/product/${externalId}`);
    expect(status.reviewState).toBe('not_applicable');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('createCourse est idempotent quand externalId est déjà connu (reprise)', async () => {
    const adapter = new HotmartAdapter();
    const ctx = makeCtx({ externalId: 'hotmart_existing_123' });
    const { externalId } = await adapter.createCourse(ctx);
    expect(externalId).toBe('hotmart_existing_123');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('journalise submitForReview sans appel réseau (pas de revue bloquante Hotmart)', async () => {
    const adapter = new HotmartAdapter();
    const ctx = makeCtx({ externalId: 'hotmart_mock_c1' });
    await adapter.submitForReview(ctx);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(ctx.deployment.logs.length).toBeGreaterThan(0);
  });
});
