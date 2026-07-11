// Tests du générateur de TP : conformité tpSchema (actions Playwright),
// fixture mock déterministe, validations métier avec retry+feedback (SDK
// Anthropic mocké — aucune requête réseau) et contrat des prompts.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreate = vi.hoisted(() => vi.fn());

// Le SDK est mocké au niveau module : aucune requête réseau possible.
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

// Cache Redis (P72) mocké par un mini-Redis en mémoire : callClaudeJson passe
// par getOrCompute AVANT tout appel réel — sans ce mock, ces tests « mode
// réel » tenteraient une vraie connexion Redis (et timeoutent).
const fakeCacheStore = vi.hoisted(() => new Map<string, string>());
vi.mock('../queues/connection.js', () => ({
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

import {
  resetConfigCache,
  tpSchema,
  tpScreenshotActionSchema,
  tpScreenshotSpecSchema,
  type TpContent,
} from '../shared.js';
import { resetClaudeClientForTests } from '../lib/claude.js';
import { extractTitleFromPrompt } from '../lib/mock-fixtures.js';
import { tpSystemPrompt, tpUserPrompt } from '../prompts/tp.js';
import { generateTpContent, mockTpContent, validateTpBusiness } from './tp.js';

const TITLE = 'TP : les concepts clés';

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

/** Variante schéma-valide mais métier-invalide : aucune screenshotSpec. */
function tpWithoutScreenshots(): TpContent {
  const tp = mockTpContent(TITLE);
  return {
    ...tp,
    steps: tp.steps.map(({ screenshotSpec: _spec, ...rest }) => ({ ...rest })),
  };
}

beforeEach(() => {
  mockCreate.mockReset();
  resetClaudeClientForTests();
  fakeCacheStore.clear();
  setTestEnv();
});

describe('tpSchema (actions Playwright)', () => {
  it('accepte la fixture mock complète', () => {
    expect(tpSchema.safeParse(mockTpContent(TITLE)).success).toBe(true);
  });

  it('rejette une action click sans selector et une action fill/goto sans value', () => {
    expect(tpScreenshotActionSchema.safeParse({ type: 'click' }).success).toBe(false);
    expect(tpScreenshotActionSchema.safeParse({ type: 'fill', selector: '#x' }).success).toBe(false);
    expect(tpScreenshotActionSchema.safeParse({ type: 'goto' }).success).toBe(false);
    expect(
      tpScreenshotActionSchema.safeParse({ type: 'fill', selector: '#x', value: 'ok' }).success,
    ).toBe(true);
  });

  it('exige une page de départ : url OU première action goto', () => {
    const sansDepart = {
      actions: [{ type: 'click', selector: '#btn' }],
      caption: 'capture',
    };
    expect(tpScreenshotSpecSchema.safeParse(sansDepart).success).toBe(false);

    const avecGoto = {
      actions: [
        { type: 'goto', value: 'http://localhost:3000/demo' },
        { type: 'click', selector: '#btn' },
      ],
      caption: 'capture',
    };
    expect(tpScreenshotSpecSchema.safeParse(avecGoto).success).toBe(true);

    const avecUrl = { url: 'http://localhost:3000', actions: [], caption: 'capture' };
    expect(tpScreenshotSpecSchema.safeParse(avecUrl).success).toBe(true);
  });

  it('exige au moins 3 étapes et des listes validation/troubleshooting non vides', () => {
    const tp = mockTpContent(TITLE);
    expect(tpSchema.safeParse({ ...tp, steps: tp.steps.slice(0, 2) }).success).toBe(false);
    expect(tpSchema.safeParse({ ...tp, validation: [] }).success).toBe(false);
    expect(tpSchema.safeParse({ ...tp, troubleshooting: [] }).success).toBe(false);
  });
});

describe('mockTpContent', () => {
  it('est déterministe par titre et paramétré par le titre', () => {
    expect(mockTpContent(TITLE)).toEqual(mockTpContent(TITLE));
    expect(mockTpContent(TITLE)).not.toEqual(mockTpContent('TP : le débogage'));
    expect(JSON.stringify(mockTpContent(TITLE))).toContain('les concepts clés');
  });

  it('respecte les règles métier (screenshotSpec sur les étapes sur ordinateur)', () => {
    const tp = mockTpContent(TITLE);
    expect(validateTpBusiness(tp)).toEqual([]);
    expect(tp.steps.filter((s) => s.screenshotSpec).length).toBeGreaterThanOrEqual(3);
  });
});

describe('validateTpBusiness', () => {
  it('signale un TP sans aucune capture et une commande non illustrée', () => {
    const problems = validateTpBusiness(tpWithoutScreenshots());
    expect(problems.some((p) => p.includes('Aucune étape'))).toBe(true);
    expect(problems.some((p) => p.includes('npm run dev'))).toBe(true);
  });

  it('ne signale rien pour un TP conforme', () => {
    expect(validateTpBusiness(mockTpContent(TITLE))).toEqual([]);
  });
});

describe('generateTpContent', () => {
  const input = {
    courseTitle: 'Apprendre Docker de zéro',
    lessonTitle: TITLE,
    summary: 'Un TP guidé sur les concepts clés.',
    difficulty: 'beginner',
    locale: 'fr',
  } as const;

  it('mode mock : fixture locale conforme, zéro appel API', async () => {
    setTestEnv({ MOCK_PROVIDERS: 'true' });
    const tp = await generateTpContent(input);
    expect(tpSchema.safeParse(tp).success).toBe(true);
    expect(validateTpBusiness(tp)).toEqual([]);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('clé API absente : bascule aussi sur la fixture mock', async () => {
    setTestEnv({ ANTHROPIC_API_KEY: '' });
    const tp = await generateTpContent(input);
    expect(tp).toEqual(mockTpContent(TITLE));
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('mode réel : retry métier avec réinjection du feedback quand les captures manquent', async () => {
    mockCreate
      .mockResolvedValueOnce(textResponse(tpWithoutScreenshots()))
      .mockResolvedValueOnce(textResponse(mockTpContent(TITLE)));

    const tp = await generateTpContent(input);
    expect(tp).toEqual(mockTpContent(TITLE));
    expect(mockCreate).toHaveBeenCalledTimes(2);

    // Le 2e appel repart du prompt de base enrichi des violations métier.
    const secondCall = mockCreate.mock.calls[1]?.[0] as { messages: { content: string }[] };
    expect(secondCall.messages[0]?.content).toContain('violait ces règles');
    expect(secondCall.messages[0]?.content).toContain('screenshotSpec');
  });

  it('mode réel : échec explicite après 3 TP métier-invalides', async () => {
    mockCreate.mockResolvedValue(textResponse(tpWithoutScreenshots()));
    await expect(generateTpContent(input)).rejects.toThrow(/TP non conforme après 3 tentatives/);
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });
});

describe('prompts TP', () => {
  it('tpUserPrompt balise le titre de la leçon en premier « … » (extraction mock)', () => {
    const user = tpUserPrompt({
      courseTitle: 'Apprendre Docker de zéro',
      lessonTitle: TITLE,
      difficulty: 'beginner',
      locale: 'fr',
    });
    expect(extractTitleFromPrompt(user)).toBe(TITLE);
    expect(user).toContain('screenshotSpec');
  });

  it('tpSystemPrompt décrit le contrat Playwright (screenshotSpec + types d’actions)', () => {
    const system = tpSystemPrompt();
    expect(system).toContain('screenshotSpec');
    for (const action of ['goto', 'click', 'fill', 'scroll', 'wait']) {
      expect(system).toContain(`"${action}"`);
    }
    expect(system).toContain('UNIQUEMENT avec un objet JSON');
  });
});
