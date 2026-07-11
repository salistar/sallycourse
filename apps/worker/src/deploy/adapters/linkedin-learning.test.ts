// Tests de l'adapter LinkedIn Learning (Prompt 102) : construction du pitch
// (mode mock puis Claude mocké au niveau SDK), sélection PURE de la leçon
// vidéo échantillon, capacités/no-op de l'adapter — aucun appel réseau réel.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILesson } from '../../shared.js';

const mockCreate = vi.hoisted(() => vi.fn());

// SDK Anthropic mocké au niveau module : aucune requête réseau possible.
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

// Cache Redis (P72) mocké par un mini-Redis en mémoire — callClaudeJson passe
// par getOrCompute AVANT tout appel réel.
const fakeCacheStore = vi.hoisted(() => new Map<string, string>());
vi.mock('../../queues/connection.js', () => ({
  getRedisConnection: () => ({
    get: async (key: string) => fakeCacheStore.get(key) ?? null,
    set: async (key: string, value: string, ...args: string[]) => {
      if (args.includes('NX') && fakeCacheStore.has(key)) return null;
      fakeCacheStore.set(key, value);
      return 'OK';
    },
    del: async (key: string) => (fakeCacheStore.delete(key) ? 1 : 0),
    exists: async (key: string) => (fakeCacheStore.has(key) ? 1 : 0),
    incr: async (key: string) => {
      const next = Number(fakeCacheStore.get(key) ?? '0') + 1;
      fakeCacheStore.set(key, String(next));
      return next;
    },
  }),
}));

import { resetConfigCache } from '../../shared.js';
import { resetClaudeClientForTests } from '../../lib/claude.js';
import { getAdapter, hasAdapter } from '../registry.js';
import {
  LINKEDIN_LEARNING_PLATFORM,
  LinkedinLearningAdapter,
  generateLinkedinPitchContent,
  linkedinPitchContentSchema,
  mockLinkedinPitchContent,
  selectSampleVideoLesson,
} from './linkedin-learning.js';
// Importe le module pour déclencher l'enregistrement (effet de bord).
import './linkedin-learning.js';

const COURSE_TITLE = 'Automatiser sa compta avec NestJS';

/** Environnement complet et valide pour getConfig (aucun accès réseau). */
function setTestEnv(overrides: Record<string, string> = {}): void {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    APP_URL: 'http://localhost:3000',
    MONGO_URI: 'mongodb://localhost:27017/test',
    REDIS_URL: 'redis://localhost:6379',
    S3_ENDPOINT: 'http://localhost:9000',
    S3_ACCESS_KEY: 'test',
    S3_SECRET_KEY: 'test',
    S3_BUCKET: 'test',
    S3_REGION: 'us-east-1',
    AUTH_SECRET: 'secret-de-test-suffisamment-long',
    CREDENTIALS_MASTER_KEY: 'a'.repeat(64),
    ANTHROPIC_API_KEY: 'sk-ant-test',
    MOCK_PROVIDERS: 'false',
    ...overrides,
  });
  resetConfigCache();
}

/** Réponse Anthropic minimale (texte JSON, stop_reason normal). */
function textResponse(payload: unknown): unknown {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }], stop_reason: 'end_turn' };
}

beforeEach(() => {
  mockCreate.mockReset();
  resetClaudeClientForTests();
  fakeCacheStore.clear();
  setTestEnv();
});

/* ------------------------------------------------------------------ */
/* Enregistrement + capacités                                          */
/* ------------------------------------------------------------------ */

describe('LinkedinLearningAdapter (registre + capacités)', () => {
  it("s'enregistre dans le registre sous 'linkedin-learning'", () => {
    expect(hasAdapter(LINKEDIN_LEARNING_PLATFORM)).toBe(true);
    expect(getAdapter(LINKEDIN_LEARNING_PLATFORM).platform).toBe(LINKEDIN_LEARNING_PLATFORM);
  });

  it('déclare le mode manuel uniquement, sans navigateur', () => {
    const adapter = new LinkedinLearningAdapter();
    expect(adapter.capabilities).toEqual({ modes: ['manual'], needsBrowser: false });
  });
});

/* ------------------------------------------------------------------ */
/* Sélection PURE de la leçon vidéo échantillon                        */
/* ------------------------------------------------------------------ */

describe('selectSampleVideoLesson', () => {
  it('sélectionne la première leçon vidéo déjà rendue', () => {
    const lessons = [
      { title: 'Article intro', type: 'article', assets: {} },
      { title: 'Leçon vidéo 1', type: 'video', assets: { videoUrl: 'courses/c1/l1.mp4' } },
      { title: 'Leçon vidéo 2', type: 'video', assets: { videoUrl: 'courses/c1/l2.mp4' } },
    ] as unknown as ILesson[];
    const sample = selectSampleVideoLesson(lessons);
    expect(sample?.title).toBe('Leçon vidéo 1');
  });

  it('ignore les leçons vidéo sans asset rendu (videoUrl absent)', () => {
    const lessons = [
      { title: 'Vidéo non rendue', type: 'video', assets: {} },
      { title: 'Vidéo rendue', type: 'video', assets: { videoUrl: 'courses/c1/l2.mp4' } },
    ] as unknown as ILesson[];
    expect(selectSampleVideoLesson(lessons)?.title).toBe('Vidéo rendue');
  });

  it('retourne null si aucune vidéo rendue disponible', () => {
    const lessons = [
      { title: 'Article', type: 'article', assets: {} },
      { title: 'TP', type: 'tp', assets: {} },
    ] as unknown as ILesson[];
    expect(selectSampleVideoLesson(lessons)).toBeNull();
  });

  it('retourne null pour un cours sans leçon', () => {
    expect(selectSampleVideoLesson([])).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Construction du pitch (mode mock puis Claude mocké)                 */
/* ------------------------------------------------------------------ */

describe('generateLinkedinPitchContent', () => {
  it('mode mock : fixture locale conforme au schéma, zéro appel API', async () => {
    setTestEnv({ MOCK_PROVIDERS: 'true' });
    const content = await generateLinkedinPitchContent(COURSE_TITLE, 'beginner', ['Leçon 1', 'Leçon 2']);
    expect(linkedinPitchContentSchema.safeParse(content).success).toBe(true);
    expect(content.pitch).toContain(COURSE_TITLE);
    expect(content.differentiators.length).toBeGreaterThanOrEqual(3);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('clé API absente : bascule aussi sur la fixture mock', async () => {
    setTestEnv({ ANTHROPIC_API_KEY: '' });
    const content = await generateLinkedinPitchContent(COURSE_TITLE, 'intermediate', []);
    expect(content).toEqual(mockLinkedinPitchContent(COURSE_TITLE));
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('est déterministe pour un même titre de cours (mode mock)', async () => {
    setTestEnv({ MOCK_PROVIDERS: 'true' });
    const a = await generateLinkedinPitchContent(COURSE_TITLE, 'beginner', []);
    const b = await generateLinkedinPitchContent(COURSE_TITLE, 'beginner', []);
    expect(a).toEqual(b);
  });

  it('mode réel : appelle Claude et valide la réponse contre le schéma', async () => {
    const payload = {
      pitch: 'Un pitch percutant en deux phrases pour ce cours.',
      planItems: ['Introduction', 'Fondamentaux', 'Pratique', 'Synthèse'],
      instructorBio: 'Formateur expert du sujet, pédagogie orientée pratique.',
      differentiators: ['Argument 1', 'Argument 2', 'Argument 3'],
    };
    mockCreate.mockResolvedValueOnce(textResponse(payload));
    const content = await generateLinkedinPitchContent(COURSE_TITLE, 'advanced', ['Leçon 1']);
    expect(content).toEqual(payload);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/* No-op documentés (authenticate/createCourse/uploadLesson/landing)    */
/* ------------------------------------------------------------------ */

describe('LinkedinLearningAdapter (no-op documentés)', () => {
  function makeCtx(): {
    logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
    deployment: { logs: unknown[]; save: ReturnType<typeof vi.fn> };
    [key: string]: unknown;
  } {
    const deployment = { logs: [] as unknown[], save: vi.fn().mockResolvedValue(undefined) };
    return {
      platform: LINKEDIN_LEARNING_PLATFORM,
      mode: 'manual',
      course: { _id: 'c1', title: COURSE_TITLE, locale: 'fr', difficulty: 'beginner' },
      sections: [],
      lessons: [],
      credentials: {},
      checkpoint: { lessonIndex: 0, step: '' },
      publishProgress: vi.fn().mockResolvedValue(undefined),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      mock: true,
      deployment,
    };
  }

  it('authenticate/createCourse/uploadLesson/setLandingPage ne font aucun appel réseau', async () => {
    const adapter = new LinkedinLearningAdapter();
    const ctx = makeCtx() as unknown as Parameters<LinkedinLearningAdapter['authenticate']>[0];

    await adapter.authenticate(ctx);
    const { externalId } = await adapter.createCourse(ctx);
    expect(externalId).toBe('c1');

    await adapter.uploadLesson(ctx, { title: 'Leçon 1' } as unknown as ILesson, 0);
    await adapter.setLandingPage(ctx);

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('getStatus renvoie published + reviewState documentant la candidature manuelle', async () => {
    const adapter = new LinkedinLearningAdapter();
    const ctx = makeCtx() as unknown as Parameters<LinkedinLearningAdapter['getStatus']>[0];
    const status = await adapter.getStatus(ctx);
    expect(status.status).toBe('published');
    expect(status.externalUrl).toBeUndefined();
    expect(status.reviewState).toContain('ready-to-submit');
    expect(status.reviewState).toContain('linkedin.com/learning-instructor');
  });
});
