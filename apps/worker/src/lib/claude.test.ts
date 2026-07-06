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

import { outlineSchema, resetConfigCache } from '../shared.js';
import {
  MAX_JSON_ATTEMPTS,
  ClaudeJsonError,
  callClaudeJson,
  extractJsonPayload,
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
