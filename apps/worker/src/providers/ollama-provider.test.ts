// Tests ollama-provider : construction de requête (pure, mock fetch), détection
// GPU, choix de modèle, et logique d'escalade après échecs de validation Zod.
// Aucun appel réseau réel — fetch et callClaudeJson sont mockés.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const mockCallClaudeJson = vi.hoisted(() => vi.fn());
vi.mock('../lib/claude.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/claude.js')>('../lib/claude.js');
  return { ...actual, callClaudeJson: mockCallClaudeJson };
});

const mockFixtureFor = vi.hoisted(() => vi.fn());
vi.mock('../lib/mock-fixtures.js', () => ({ mockFixtureFor: mockFixtureFor }));

import { resetConfigCache } from '../shared.js';
import {
  MAX_OLLAMA_ATTEMPTS,
  buildOllamaRequest,
  callOllamaJson,
  detectOllamaGpu,
  isOllamaConfigured,
  recommendedOllamaModel,
} from './ollama-provider.js';

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
    MOCK_PROVIDERS: 'false',
    ...overrides,
  });
  // Supprime les clés non fournies (une valeur vide est ignorée par stripEmpty
  // côté getConfig, donc on la retire complètement de l'environnement).
  for (const key of ['ANTHROPIC_API_KEY', 'OLLAMA_BASE_URL', 'OLLAMA_MODEL_CRITICAL', 'OLLAMA_MODEL_SIMPLE', 'OLLAMA_HAS_GPU']) {
    if (!(key in overrides)) delete process.env[key];
  }
  resetConfigCache();
}

const simpleSchema = z.object({ name: z.string(), count: z.number().int() });

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  mockCallClaudeJson.mockReset();
  mockFixtureFor.mockReset();
  // OLLAMA_HAS_GPU=false fige recommendedOllamaModel sans requête /api/tags
  // supplémentaire — les tests callOllamaJson ci-dessous ne mockent que /api/generate.
  setTestEnv({ OLLAMA_BASE_URL: 'http://localhost:11434', OLLAMA_HAS_GPU: 'false' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetConfigCache();
});

describe('buildOllamaRequest', () => {
  it('construit une requête /api/generate avec format json forcé', () => {
    const req = buildOllamaRequest('qwen2.5:14b', 'système', 'utilisateur');
    expect(req).toEqual({
      model: 'qwen2.5:14b',
      prompt: 'utilisateur',
      system: 'système',
      format: 'json',
      stream: false,
    });
  });

  it('inclut la température si fournie', () => {
    const req = buildOllamaRequest('qwen2.5:14b', 'système', 'utilisateur', 0.7);
    expect(req.options).toEqual({ temperature: 0.7 });
  });
});

describe('isOllamaConfigured', () => {
  it('faux si MOCK_PROVIDERS actif même avec une URL', () => {
    setTestEnv({ OLLAMA_BASE_URL: 'http://localhost:11434', MOCK_PROVIDERS: 'true' });
    expect(isOllamaConfigured()).toBe(false);
  });

  it('faux si OLLAMA_BASE_URL absente', () => {
    setTestEnv({});
    expect(isOllamaConfigured()).toBe(false);
  });

  it('vrai si URL configurée et mode mock inactif', () => {
    expect(isOllamaConfigured()).toBe(true);
  });
});

describe('detectOllamaGpu', () => {
  it('retourne true immédiatement si OLLAMA_HAS_GPU=true (pas de requête réseau)', async () => {
    setTestEnv({ OLLAMA_BASE_URL: 'http://localhost:11434', OLLAMA_HAS_GPU: 'true' });
    const gpu = await detectOllamaGpu();
    expect(gpu).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('détecte un GPU si un modèle 70b/72b est déjà tiré', async () => {
    setTestEnv({ OLLAMA_BASE_URL: 'http://localhost:11434' }); // OLLAMA_HAS_GPU absente : force la requête /api/tags
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [{ name: 'llama3.3:70b' }] }),
    });
    expect(await detectOllamaGpu()).toBe(true);
  });

  it('pas de GPU si seuls des petits modèles sont tirés', async () => {
    setTestEnv({ OLLAMA_BASE_URL: 'http://localhost:11434' });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [{ name: 'qwen2.5:14b' }] }),
    });
    expect(await detectOllamaGpu()).toBe(false);
  });

  it('pas de GPU (sans jeter) si /api/tags est injoignable', async () => {
    setTestEnv({ OLLAMA_BASE_URL: 'http://localhost:11434' });
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await detectOllamaGpu()).toBe(false);
  });
});

describe('recommendedOllamaModel', () => {
  it('respecte les surcharges .env en priorité', async () => {
    setTestEnv({
      OLLAMA_BASE_URL: 'http://localhost:11434',
      OLLAMA_MODEL_CRITICAL: 'custom-critical',
      OLLAMA_MODEL_SIMPLE: 'custom-simple',
    });
    expect(await recommendedOllamaModel(true)).toBe('custom-critical');
    expect(await recommendedOllamaModel(false)).toBe('custom-simple');
  });

  it('sans GPU : simple → llama3.2:8b, critique → qwen2.5:14b (repli raisonnable)', async () => {
    setTestEnv({ OLLAMA_BASE_URL: 'http://localhost:11434', OLLAMA_HAS_GPU: 'false' });
    expect(await recommendedOllamaModel(false)).toBe('llama3.2:8b');
    expect(await recommendedOllamaModel(true)).toBe('qwen2.5:14b');
  });

  it('avec GPU : critique → llama3.3:70b, simple → qwen2.5:14b', async () => {
    setTestEnv({ OLLAMA_BASE_URL: 'http://localhost:11434', OLLAMA_HAS_GPU: 'true' });
    expect(await recommendedOllamaModel(true)).toBe('llama3.3:70b');
    expect(await recommendedOllamaModel(false)).toBe('qwen2.5:14b');
  });
});

describe('callOllamaJson — routage critique / non configuré', () => {
  it('critical=true : appelle callClaudeJson directement, jamais Ollama', async () => {
    mockCallClaudeJson.mockResolvedValueOnce({ name: 'x', count: 1 });
    const result = await callOllamaJson({ schema: simpleSchema, system: 's', user: 'u', critical: true });
    expect(result).toEqual({ name: 'x', count: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockCallClaudeJson).toHaveBeenCalledTimes(1);
  });

  it('Ollama non configuré : repli direct sur callClaudeJson', async () => {
    setTestEnv({}); // pas de OLLAMA_BASE_URL
    mockCallClaudeJson.mockResolvedValueOnce({ name: 'y', count: 2 });
    const result = await callOllamaJson({ schema: simpleSchema, system: 's', user: 'u' });
    expect(result).toEqual({ name: 'y', count: 2 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('callOllamaJson — succès Ollama', () => {
  it('retourne le JSON validé dès la première tentative', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ response: JSON.stringify({ name: 'ok', count: 3 }) }),
    });
    const result = await callOllamaJson({ schema: simpleSchema, system: 's', user: 'u' });
    expect(result).toEqual({ name: 'ok', count: 3 });
    expect(mockCallClaudeJson).not.toHaveBeenCalled();
  });
});

describe('callOllamaJson — escalade après échecs de validation', () => {
  it('escalade vers callClaudeJson (cloud) après MAX_OLLAMA_ATTEMPTS validations Zod échouées', async () => {
    setTestEnv({ OLLAMA_BASE_URL: 'http://localhost:11434', OLLAMA_HAS_GPU: 'false', ANTHROPIC_API_KEY: 'sk-ant-test' });
    // Chaque tentative Ollama renvoie un JSON qui échoue la validation (count manquant).
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ response: JSON.stringify({ name: 'incomplet' }) }),
    });
    mockCallClaudeJson.mockResolvedValueOnce({ name: 'cloud', count: 9 });

    const result = await callOllamaJson({ schema: simpleSchema, system: 's', user: 'u' });

    expect(result).toEqual({ name: 'cloud', count: 9 });
    expect(fetchMock).toHaveBeenCalledTimes(MAX_OLLAMA_ATTEMPTS);
    expect(mockCallClaudeJson).toHaveBeenCalledTimes(1);
    // skipCache=true : la 2e tentative business ne doit pas rejouer une réponse en cache.
    expect(mockCallClaudeJson).toHaveBeenCalledWith(expect.objectContaining({ skipCache: true }));
  });

  it('escalade vers mock-fixtures (pas cloud) si aucune clé Anthropic disponible', async () => {
    setTestEnv({ OLLAMA_BASE_URL: 'http://localhost:11434', OLLAMA_HAS_GPU: 'false' }); // pas de ANTHROPIC_API_KEY
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ response: JSON.stringify({ name: 'incomplet' }) }),
    });
    mockFixtureFor.mockReturnValueOnce({ name: 'mock', count: 0 });

    const result = await callOllamaJson({ schema: simpleSchema, system: 's', user: 'u' });

    expect(result).toEqual({ name: 'mock', count: 0 });
    expect(mockCallClaudeJson).not.toHaveBeenCalled();
    expect(mockFixtureFor).toHaveBeenCalledTimes(1);
  });

  it('Ollama injoignable dès le premier appel : escalade immédiate sans retry local', async () => {
    setTestEnv({ OLLAMA_BASE_URL: 'http://localhost:11434', OLLAMA_HAS_GPU: 'false', ANTHROPIC_API_KEY: 'sk-ant-test' });
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    mockCallClaudeJson.mockResolvedValueOnce({ name: 'cloud-direct', count: 5 });

    const result = await callOllamaJson({ schema: simpleSchema, system: 's', user: 'u' });

    expect(result).toEqual({ name: 'cloud-direct', count: 5 });
    expect(fetchMock).toHaveBeenCalledTimes(1); // pas de 2e/3e tentative locale
    expect(mockCallClaudeJson).toHaveBeenCalledTimes(1);
  });

  it('JSON non parsable réessayé jusqu’à MAX_OLLAMA_ATTEMPTS puis escalade', async () => {
    setTestEnv({ OLLAMA_BASE_URL: 'http://localhost:11434', OLLAMA_HAS_GPU: 'false', ANTHROPIC_API_KEY: 'sk-ant-test' });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ response: 'pas du json' }) });
    mockCallClaudeJson.mockResolvedValueOnce({ name: 'cloud', count: 1 });

    const result = await callOllamaJson({ schema: simpleSchema, system: 's', user: 'u' });

    expect(result).toEqual({ name: 'cloud', count: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(MAX_OLLAMA_ATTEMPTS);
  });
});
