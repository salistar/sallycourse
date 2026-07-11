// Tests de l'adapter Systeme.io (Prompt 104) : génération de la séquence email
// (schéma, mode mock puis Claude mocké) et construction PURE des requêtes API
// (course/module/lesson) — aucun appel réseau réel dans ces tests.
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
import {
  EMAIL_SEQUENCE_DAYS,
  buildCourseRequest,
  buildLessonRequest,
  buildModuleRequest,
  capturePageSchema,
  emailSequenceSchema,
  generateCapturePage,
  generateEmailSequence,
  lessonContentFor,
  nurturingEmailSchema,
} from './systeme-io.js';

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

/** Réponse Messages API minimale (bloc texte unique). */
function textResponse(payload: unknown): unknown {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }], stop_reason: 'end_turn' };
}

beforeEach(() => {
  mockCreate.mockReset();
  resetClaudeClientForTests();
  fakeCacheStore.clear();
  setTestEnv();
});

describe('generateCapturePage', () => {
  it('mode mock : fixture locale conforme, zéro appel API', async () => {
    setTestEnv({ MOCK_PROVIDERS: 'true' });
    const page = await generateCapturePage(COURSE_TITLE);
    expect(capturePageSchema.safeParse(page).success).toBe(true);
    expect(page.benefits.length).toBeGreaterThanOrEqual(3);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('clé API absente : bascule aussi sur la fixture mock', async () => {
    setTestEnv({ ANTHROPIC_API_KEY: '' });
    const page = await generateCapturePage(COURSE_TITLE);
    expect(page.headline).toContain(COURSE_TITLE);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('mode réel : appelle Claude et valide la réponse contre le schéma', async () => {
    const payload = {
      headline: 'Titre accrocheur',
      subheadline: 'Sous-titre',
      benefits: ['Bénéfice 1', 'Bénéfice 2', 'Bénéfice 3'],
      ctaLabel: 'Je m’inscris',
    };
    mockCreate.mockResolvedValueOnce(textResponse(payload));
    const page = await generateCapturePage(COURSE_TITLE);
    expect(page).toEqual(payload);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});

describe('generateEmailSequence', () => {
  it('mode mock : 5 emails, schéma conforme, délais croissants, zéro appel API', async () => {
    setTestEnv({ MOCK_PROVIDERS: 'true' });
    const emails = await generateEmailSequence(COURSE_TITLE);
    expect(emails).toHaveLength(EMAIL_SEQUENCE_DAYS);
    emails.forEach((email) => {
      expect(nurturingEmailSchema.safeParse(email).success).toBe(true);
    });
    expect(emails.map((e) => e.sendDelayDays)).toEqual([0, 1, 2, 3, 4]);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('est déterministe pour un même titre de cours', async () => {
    setTestEnv({ MOCK_PROVIDERS: 'true' });
    const a = await generateEmailSequence(COURSE_TITLE);
    const b = await generateEmailSequence(COURSE_TITLE);
    expect(a).toEqual(b);
  });

  it('mode réel : appelle Claude et valide la séquence contre le schéma', async () => {
    const payload = {
      emails: Array.from({ length: EMAIL_SEQUENCE_DAYS }, (_, i) => ({
        subject: `Email ${i + 1}`,
        body: `Corps de l'email ${i + 1}`,
        sendDelayDays: i,
      })),
    };
    expect(emailSequenceSchema.safeParse(payload).success).toBe(true);
    mockCreate.mockResolvedValueOnce(textResponse(payload));

    const emails = await generateEmailSequence(COURSE_TITLE);
    expect(emails).toEqual(payload.emails);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('rejette une séquence qui ne compte pas exactement 5 emails', () => {
    const tooFew = { emails: [{ subject: 'x', body: 'y', sendDelayDays: 0 }] };
    expect(emailSequenceSchema.safeParse(tooFew).success).toBe(false);
  });
});

describe('construction des requêtes API (pure)', () => {
  it('buildCourseRequest reprend titre + description telles quelles', () => {
    expect(buildCourseRequest(COURSE_TITLE, 'Description complète')).toEqual({
      title: COURSE_TITLE,
      description: 'Description complète',
    });
  });

  it('buildModuleRequest porte le titre de section et sa position', () => {
    expect(buildModuleRequest('Section 1', 1)).toEqual({ title: 'Section 1', position: 1 });
  });

  it('buildLessonRequest convertit un index 0-based en position 1-based', () => {
    const req = buildLessonRequest({ title: 'Leçon A', content: 'Contenu A' }, 0);
    expect(req).toEqual({ title: 'Leçon A', content: 'Contenu A', position: 1 });

    const req2 = buildLessonRequest({ title: 'Leçon B', content: 'Contenu B' }, 4);
    expect(req2.position).toBe(5);
  });

  it('lessonContentFor priorise generatedSummary puis summary puis le titre', () => {
    expect(
      lessonContentFor({ title: 'T', summary: 'S', generatedSummary: 'G' } as never),
    ).toBe('G');
    expect(lessonContentFor({ title: 'T', summary: 'S' } as never)).toBe('S');
    expect(lessonContentFor({ title: 'T' } as never)).toBe('T');
  });
});
