// Tests de callClaudeJson : extraction JSON (fences), retry sur validation
// Zod échouée (client Anthropic mocké), troncature, et mode MOCK_PROVIDERS.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const mockCreate = vi.hoisted(() => vi.fn());

// Le SDK est mocké au niveau module : aucune requête réseau possible.
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

// Cache Redis (P72) mocké par un mini-Redis en mémoire : callClaudeJson passe
// désormais par getOrCompute AVANT tout appel réel — sans ce mock, les tests
// de retry/troncature ci-dessous tenteraient une vraie connexion Redis.
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

import { outlineSchema, resetConfigCache } from '../shared.js';
import {
  MAX_JSON_ATTEMPTS,
  MAX_RATE_LIMIT_RETRIES,
  RATE_LIMIT_BASE_DELAY_MS,
  ClaudeJsonError,
  callClaudeJson,
  extractJsonPayload,
  isRateLimitError,
  resetClaudeClientForTests,
} from './claude.js';

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
function textResponse(text: string, stopReason: string = 'end_turn'): unknown {
  return { content: [{ type: 'text', text }], stop_reason: stopReason };
}

const simpleSchema = z.object({ name: z.string(), count: z.number().int() });

beforeEach(() => {
  mockCreate.mockReset();
  resetClaudeClientForTests();
  fakeCacheStore.clear();
  setTestEnv();
});

afterEach(() => {
  resetConfigCache();
});

describe('extractJsonPayload', () => {
  it('extrait le JSON depuis une fence ```json', () => {
    const raw = 'Voici le résultat :\n```json\n{"name":"x","count":1}\n```\nBonne journée.';
    expect(JSON.parse(extractJsonPayload(raw))).toEqual({ name: 'x', count: 1 });
  });

  it('extrait le JSON depuis une fence sans langage', () => {
    expect(JSON.parse(extractJsonPayload('```\n{"a":[1,2]}\n```'))).toEqual({ a: [1, 2] });
  });

  it('laisse passer le JSON nu (objet et tableau)', () => {
    expect(extractJsonPayload('  {"a":1}  ')).toBe('{"a":1}');
    expect(extractJsonPayload('[1,2,3]')).toBe('[1,2,3]');
  });

  it('récupère le premier bloc JSON noyé dans de la prose', () => {
    const raw = 'Le plan demandé est {"name":"y","count":2} — dites-moi si cela convient.';
    expect(JSON.parse(extractJsonPayload(raw))).toEqual({ name: 'y', count: 2 });
  });

  it('ne TRONQUE PAS un JSON fencé dont une valeur contient des blocs de code ``` (bug Gemini→articles)', () => {
    // Gemini emballe le JSON dans ```json ; le markdown de l'article contient
    // ses propres ```bash…``` : la regex non-greedy tronquait au 1er ``` interne.
    const article = { title: 'Docker', markdown: '## Intro\n\n```bash\nnpm i\n```\n\nSuite.', readingTimeMin: 5 };
    const raw = '```json\n' + JSON.stringify(article, null, 2) + '\n```';
    expect(JSON.parse(extractJsonPayload(raw))).toEqual(article);
  });

  it('gère un markdown fencé se terminant par un bloc de code', () => {
    const doc = { md: 'texte\n\n```js\nconst a = 1;\n```' };
    const raw = '```json\n' + JSON.stringify(doc) + '\n```';
    expect(JSON.parse(extractJsonPayload(raw))).toEqual(doc);
  });

  it('laisse passer un JSON nu contenant des ``` internes', () => {
    const doc = { md: '```py\nprint(1)\n```' };
    expect(JSON.parse(extractJsonPayload(JSON.stringify(doc)))).toEqual(doc);
  });
});

describe('callClaudeJson — mode mock', () => {
  it('MOCK_PROVIDERS=true court-circuite le SDK et retourne une fixture valide', async () => {
    setTestEnv({ MOCK_PROVIDERS: 'true' });
    const outline = await callClaudeJson({
      schema: outlineSchema,
      system: 'système',
      user: 'Titre du cours : « Apprendre Docker de zéro »',
    });
    expect(outlineSchema.safeParse(outline).success).toBe(true);
    expect(outline.title).toContain('Docker');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("bascule aussi en mock quand ANTHROPIC_API_KEY est absente", async () => {
    setTestEnv({ ANTHROPIC_API_KEY: '' });
    const outline = await callClaudeJson({
      schema: outlineSchema,
      system: 'système',
      user: 'Titre du cours : « Python »',
    });
    expect(outlineSchema.safeParse(outline).success).toBe(true);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('callClaudeJson — retry sur schéma invalide', () => {
  it('réinjecte les erreurs de validation puis retourne le JSON corrigé', async () => {
    mockCreate
      .mockResolvedValueOnce(textResponse('```json\n{"name":"x"}\n```')) // count manquant
      .mockResolvedValueOnce(textResponse('{"name":"x","count":3}'));

    const result = await callClaudeJson({ schema: simpleSchema, system: 's', user: 'u' });
    expect(result).toEqual({ name: 'x', count: 3 });
    expect(mockCreate).toHaveBeenCalledTimes(2);

    // 2e appel : la conversation contient la sortie fautive + le feedback Zod.
    const secondCall = mockCreate.mock.calls[1]?.[0] as { messages: { role: string; content: string }[] };
    expect(secondCall.messages).toHaveLength(3);
    expect(secondCall.messages[1]?.role).toBe('assistant');
    expect(secondCall.messages[2]?.content).toMatch(/validation/i);
    expect(secondCall.messages[2]?.content).toContain('count');
  });

  it('retente aussi quand la sortie n’est pas du JSON parsable', async () => {
    mockCreate
      .mockResolvedValueOnce(textResponse('Désolé, je ne peux pas produire de JSON.'))
      .mockResolvedValueOnce(textResponse('{"name":"ok","count":1}'));

    const result = await callClaudeJson({ schema: simpleSchema, system: 's', user: 'u' });
    expect(result).toEqual({ name: 'ok', count: 1 });
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it(`abandonne après ${MAX_JSON_ATTEMPTS} tentatives avec une erreur explicite`, async () => {
    mockCreate.mockResolvedValue(textResponse('{"name":"x"}')); // toujours invalide

    await expect(callClaudeJson({ schema: simpleSchema, system: 's', user: 'u' })).rejects.toThrow(
      ClaudeJsonError,
    );
    expect(mockCreate).toHaveBeenCalledTimes(MAX_JSON_ATTEMPTS);
  });
});

describe('callClaudeJson — troncature', () => {
  it('jette une erreur explicite quand stop_reason=max_tokens', async () => {
    mockCreate.mockResolvedValueOnce(textResponse('{"name":"x"', 'max_tokens'));

    await expect(
      callClaudeJson({ schema: simpleSchema, system: 's', user: 'u', maxTokens: 128 }),
    ).rejects.toThrow(/tronquée|max_tokens/);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});

describe('callClaudeJson — cache (P72)', () => {
  it('un second appel identique (même system+user+model) ne rappelle pas le SDK', async () => {
    mockCreate.mockResolvedValueOnce(textResponse('{"name":"x","count":1}'));

    const first = await callClaudeJson({ schema: simpleSchema, system: 'sys-cache', user: 'user-cache' });
    const second = await callClaudeJson({ schema: simpleSchema, system: 'sys-cache', user: 'user-cache' });

    expect(first).toEqual({ name: 'x', count: 1 });
    expect(second).toEqual({ name: 'x', count: 1 });
    expect(mockCreate).toHaveBeenCalledTimes(1); // 2e appel servi depuis le cache
  });

  it('un system ou un user différent recalcule (clé de cache distincte)', async () => {
    mockCreate
      .mockResolvedValueOnce(textResponse('{"name":"a","count":1}'))
      .mockResolvedValueOnce(textResponse('{"name":"b","count":2}'));

    const first = await callClaudeJson({ schema: simpleSchema, system: 'sys-1', user: 'user-1' });
    const second = await callClaudeJson({ schema: simpleSchema, system: 'sys-2', user: 'user-1' });

    expect(first).toEqual({ name: 'a', count: 1 });
    expect(second).toEqual({ name: 'b', count: 2 });
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('le mode mock ne passe jamais par le cache (fixtures toujours gratuites)', async () => {
    setTestEnv({ MOCK_PROVIDERS: 'true' });
    await callClaudeJson({ schema: outlineSchema, system: 's', user: 'Titre du cours : « Rust »' });
    await callClaudeJson({ schema: outlineSchema, system: 's', user: 'Titre du cours : « Rust »' });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(fakeCacheStore.size).toBe(0);
  });
});

describe('callClaudeJson — backoff local sur 429 répétés (P77)', () => {
  it('détecte un 429 via isRateLimitError', () => {
    expect(isRateLimitError({ status: 429 })).toBe(true);
    expect(isRateLimitError({ status: 500 })).toBe(false);
    expect(isRateLimitError(new Error('boom'))).toBe(false);
    expect(isRateLimitError(null)).toBe(false);
  });

  it('retente après un délai croissant sur 429 puis réussit', async () => {
    vi.useFakeTimers();
    try {
      const rateLimitErr = Object.assign(new Error('rate limited'), { status: 429 });
      mockCreate
        .mockRejectedValueOnce(rateLimitErr)
        .mockRejectedValueOnce(rateLimitErr)
        .mockResolvedValueOnce(textResponse('{"name":"x","count":1}'));

      const promise = callClaudeJson({ schema: simpleSchema, system: 's-429', user: 'u-429' });
      // Laisse la micro-tâche du premier appel s'exécuter avant d'avancer les timers.
      await vi.advanceTimersByTimeAsync(RATE_LIMIT_BASE_DELAY_MS * (2 ** 0 + 2 ** 1) + 10);

      const result = await promise;
      expect(result).toEqual({ name: 'x', count: 1 });
      expect(mockCreate).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it(`abandonne après ${MAX_RATE_LIMIT_RETRIES} tentatives supplémentaires de 429 persistant`, async () => {
    vi.useFakeTimers();
    try {
      const rateLimitErr = Object.assign(new Error('rate limited'), { status: 429 });
      mockCreate.mockRejectedValue(rateLimitErr);

      const promise = callClaudeJson({ schema: simpleSchema, system: 's-429b', user: 'u-429b' }).catch(
        (err) => err,
      );

      // Avance largement au-delà de la somme des délais croissants.
      let totalDelay = 0;
      for (let i = 0; i <= MAX_RATE_LIMIT_RETRIES; i++) totalDelay += RATE_LIMIT_BASE_DELAY_MS * 2 ** i;
      await vi.advanceTimersByTimeAsync(totalDelay + 1000);

      const err = await promise;
      expect(err).toBe(rateLimitErr);
      // 1 essai initial + MAX_RATE_LIMIT_RETRIES retries = MAX_RATE_LIMIT_RETRIES + 1 appels.
      expect(mockCreate).toHaveBeenCalledTimes(MAX_RATE_LIMIT_RETRIES + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ne retente pas sur une erreur autre que 429 (échoue immédiatement)', async () => {
    const other = Object.assign(new Error('serveur en panne'), { status: 500 });
    mockCreate.mockRejectedValueOnce(other);

    await expect(
      callClaudeJson({ schema: simpleSchema, system: 's-500', user: 'u-500' }),
    ).rejects.toThrow('serveur en panne');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});

describe('claudeCacheKey', () => {
  it('est déterministe et dépend des trois paramètres', async () => {
    const { claudeCacheKey } = await import('./claude.js');
    expect(claudeCacheKey('s', 'u', 'm')).toBe(claudeCacheKey('s', 'u', 'm'));
    expect(claudeCacheKey('s', 'u', 'm')).not.toBe(claudeCacheKey('s2', 'u', 'm'));
    expect(claudeCacheKey('s', 'u', 'm')).not.toBe(claudeCacheKey('s', 'u2', 'm'));
    expect(claudeCacheKey('s', 'u', 'm')).not.toBe(claudeCacheKey('s', 'u', 'm2'));
  });
});
