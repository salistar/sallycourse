// Tests du provider Piper (Prompt 153) : sélection de voix par langue (pure),
// détection de configuration, et repli si le service est down (mock fetch qui
// échoue). Aucun vrai appel réseau ici.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConfigCache } from '../shared.js';
import { isPiperConfigured, resolvePiperVoice, synthesizePiper } from './piper-provider.js';

/** Environnement complet et valide pour getConfig. */
function setTestEnv(overrides: Record<string, string | undefined> = {}): void {
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
  });
  delete process.env.PIPER_BASE_URL;
  delete process.env.MOCK_PROVIDERS;
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetConfigCache();
}

beforeEach(() => {
  setTestEnv();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('resolvePiperVoice', () => {
  it('privilégie la voix forcée quand fournie', () => {
    expect(resolvePiperVoice('fr', 'ma-voix-custom')).toBe('ma-voix-custom');
    expect(resolvePiperVoice('en', '  voix-espacée  ')).toBe('voix-espacée');
  });

  it('retombe sur une voix par défaut selon la langue (fr/en/ar)', () => {
    expect(resolvePiperVoice('fr')).toBe('fr_FR-siwis-medium');
    expect(resolvePiperVoice('en')).toBe('en_US-lessac-medium');
    expect(resolvePiperVoice('ar')).toBeTruthy(); // repli documenté (pas de modèle arabe officiel)
  });

  it('retombe sur la voix EN pour une langue inconnue', () => {
    expect(resolvePiperVoice('xx')).toBe(resolvePiperVoice('en'));
  });
});

describe('isPiperConfigured', () => {
  it('false si PIPER_BASE_URL absente', () => {
    setTestEnv();
    expect(isPiperConfigured()).toBe(false);
  });

  it('true si PIPER_BASE_URL présente et MOCK_PROVIDERS désactivé', () => {
    setTestEnv({ PIPER_BASE_URL: 'http://localhost:10201' });
    expect(isPiperConfigured()).toBe(true);
  });

  it('false si MOCK_PROVIDERS actif même avec PIPER_BASE_URL présente', () => {
    setTestEnv({ PIPER_BASE_URL: 'http://localhost:10201', MOCK_PROVIDERS: 'true' });
    expect(isPiperConfigured()).toBe(false);
  });
});

describe('synthesizePiper — repli si le service est down', () => {
  it('jette une erreur explicite si PIPER_BASE_URL absente', async () => {
    setTestEnv();
    await expect(synthesizePiper('Bonjour', 'fr', undefined, 1)).rejects.toThrow(/PIPER_BASE_URL/);
  });

  it('jette une erreur avec le statut HTTP si le service répond en erreur (mock fetch échoué)', async () => {
    setTestEnv({ PIPER_BASE_URL: 'http://localhost:10201' });
    const fetchMock = vi.fn(async () => new Response('service indisponible', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(synthesizePiper('Bonjour', 'fr', undefined, 1)).rejects.toThrow(/Piper 503/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retourne le buffer audio brut si le service répond 200', async () => {
    setTestEnv({ PIPER_BASE_URL: 'http://localhost:10201' });
    const fetchMock = vi.fn(async () => new Response(Buffer.from('fake-wav-bytes'), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const buf = await synthesizePiper('Bonjour', 'fr', undefined, 1);
    expect(buf.toString()).toBe('fake-wav-bytes');
  });
});
