// Tests du provider Kokoro (Prompt 153) : sélection de voix par langue (pure),
// gating ElevenLabs premium par plan, détection de configuration, et repli si
// le service est down (mock fetch qui échoue). Aucun vrai appel réseau ici.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConfigCache } from '../shared.js';
import {
  createKokoroClonedVoice,
  isElevenLabsAllowedForPlan,
  isKokoroConfigured,
  mockKokoroVoiceId,
  resolveKokoroVoice,
  synthesizeKokoro,
} from './kokoro-provider.js';

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
  delete process.env.KOKORO_BASE_URL;
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

describe('resolveKokoroVoice', () => {
  it('privilégie la voix forcée/clonée quand fournie', () => {
    expect(resolveKokoroVoice('fr', 'mock-kokoro-voice-abc')).toBe('mock-kokoro-voice-abc');
  });

  it('retombe sur une voix par défaut selon la langue (fr/en/ar)', () => {
    expect(resolveKokoroVoice('fr')).toBe('ff_siwis');
    expect(resolveKokoroVoice('en')).toBe('af_heart');
    expect(resolveKokoroVoice('ar')).toBeTruthy();
  });
});

describe('isElevenLabsAllowedForPlan (P153 — ElevenLabs devient PREMIUM)', () => {
  it('refuse le plan free', () => {
    expect(isElevenLabsAllowedForPlan('free')).toBe(false);
  });

  it('autorise pro et business', () => {
    expect(isElevenLabsAllowedForPlan('pro')).toBe(true);
    expect(isElevenLabsAllowedForPlan('business')).toBe(true);
  });

  it('plan absent/inconnu → traité comme free (refusé, aucun passe-droit implicite)', () => {
    expect(isElevenLabsAllowedForPlan(undefined)).toBe(false);
    expect(isElevenLabsAllowedForPlan(null)).toBe(false);
    expect(isElevenLabsAllowedForPlan('plan-inconnu')).toBe(false);
  });
});

describe('isKokoroConfigured', () => {
  it('false si KOKORO_BASE_URL absente', () => {
    setTestEnv();
    expect(isKokoroConfigured()).toBe(false);
  });

  it('true si KOKORO_BASE_URL présente et MOCK_PROVIDERS désactivé', () => {
    setTestEnv({ KOKORO_BASE_URL: 'http://localhost:8880' });
    expect(isKokoroConfigured()).toBe(true);
  });

  it('false si MOCK_PROVIDERS actif même avec KOKORO_BASE_URL présente', () => {
    setTestEnv({ KOKORO_BASE_URL: 'http://localhost:8880', MOCK_PROVIDERS: 'true' });
    expect(isKokoroConfigured()).toBe(false);
  });
});

describe('mockKokoroVoiceId', () => {
  it('est déterministe pour un même (userId, label)', () => {
    expect(mockKokoroVoiceId('user1', 'Ma voix')).toBe(mockKokoroVoiceId('user1', 'Ma voix'));
  });

  it('distingue deux utilisateurs ou labels différents', () => {
    expect(mockKokoroVoiceId('user1', 'Ma voix')).not.toBe(mockKokoroVoiceId('user2', 'Ma voix'));
  });
});

describe('createKokoroClonedVoice — mock déterministe (aucune URL Kokoro en test)', () => {
  it('retourne un voiceId fictif sans appel réseau', async () => {
    setTestEnv();
    const result = await createKokoroClonedVoice('user42', Buffer.from('audio-fictif'), 'Voix instructeur');
    expect(result.live).toBe(false);
    expect(result.voiceId).toBe(mockKokoroVoiceId('user42', 'Voix instructeur'));
  });
});

describe('synthesizeKokoro — repli si le service est down', () => {
  it('jette une erreur explicite si KOKORO_BASE_URL absente', async () => {
    setTestEnv();
    await expect(synthesizeKokoro('Bonjour', 'fr', undefined, 1)).rejects.toThrow(/KOKORO_BASE_URL/);
  });

  it('jette une erreur avec le statut HTTP si le service répond en erreur (mock fetch échoué)', async () => {
    setTestEnv({ KOKORO_BASE_URL: 'http://localhost:8880' });
    const fetchMock = vi.fn(async () => new Response('service indisponible', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(synthesizeKokoro('Bonjour', 'fr', undefined, 1)).rejects.toThrow(/Kokoro 503/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retourne le buffer audio brut si le service répond 200', async () => {
    setTestEnv({ KOKORO_BASE_URL: 'http://localhost:8880' });
    const fetchMock = vi.fn(async () => new Response(Buffer.from('fake-mp3-bytes'), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const buf = await synthesizeKokoro('Bonjour', 'fr', undefined, 1);
    expect(buf.toString()).toBe('fake-mp3-bytes');
  });
});
