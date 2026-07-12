// Tests du provider SadTalker (Prompt 155) : sélection PURE du provider
// avatar (plan + disponibilité GPU/service), gating HeyGen premium par plan,
// détection de configuration (endpoint + GPU déclaré), et repli si le service
// est down (mock fetch qui échoue). Aucun vrai appel réseau ni GPU réel ici.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConfigCache } from '../shared.js';
import {
  isHeyGenAllowedForPlan,
  isSadTalkerConfigured,
  renderSadTalkerAvatar,
  selectAvatarProvider,
} from './sadtalker-provider.js';

/** Environnement complet et valide pour getConfig. */
function setTestEnv(overrides: Record<string, string | undefined> = {}): void {
  delete process.env.SADTALKER_BASE_URL;
  delete process.env.SADTALKER_HAS_GPU;
  delete process.env.MOCK_PROVIDERS;
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
    ...overrides,
  });
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
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

describe('isHeyGenAllowedForPlan (P155 — HeyGen reste PREMIUM)', () => {
  it('refuse le plan free', () => {
    expect(isHeyGenAllowedForPlan('free')).toBe(false);
  });

  it('autorise pro et business', () => {
    expect(isHeyGenAllowedForPlan('pro')).toBe(true);
    expect(isHeyGenAllowedForPlan('business')).toBe(true);
  });

  it('plan absent/inconnu → traité comme free (refusé, aucun passe-droit implicite)', () => {
    expect(isHeyGenAllowedForPlan(undefined)).toBe(false);
    expect(isHeyGenAllowedForPlan(null)).toBe(false);
    expect(isHeyGenAllowedForPlan('plan-inconnu')).toBe(false);
  });
});

describe('isSadTalkerConfigured', () => {
  it('false si SADTALKER_BASE_URL absente', () => {
    setTestEnv({ SADTALKER_HAS_GPU: 'true' });
    expect(isSadTalkerConfigured()).toBe(false);
  });

  it('false si GPU non déclaré même avec SADTALKER_BASE_URL présente', () => {
    setTestEnv({ SADTALKER_BASE_URL: 'http://localhost:9500' });
    expect(isSadTalkerConfigured()).toBe(false);
  });

  it('true si endpoint + GPU déclaré et MOCK_PROVIDERS désactivé', () => {
    setTestEnv({ SADTALKER_BASE_URL: 'http://localhost:9500', SADTALKER_HAS_GPU: 'true' });
    expect(isSadTalkerConfigured()).toBe(true);
  });

  it('false si MOCK_PROVIDERS actif même avec endpoint + GPU', () => {
    setTestEnv({ SADTALKER_BASE_URL: 'http://localhost:9500', SADTALKER_HAS_GPU: 'true', MOCK_PROVIDERS: 'true' });
    expect(isSadTalkerConfigured()).toBe(false);
  });
});

describe('selectAvatarProvider — sélection PURE (plan + disponibilité GPU)', () => {
  it('choisit SadTalker si configuré ET une photo source existe, quel que soit le plan', () => {
    expect(
      selectAvatarProvider({
        plan: 'free',
        heygenConfigured: true,
        sadTalkerConfigured: true,
        hasSourcePhoto: true,
        avatarId: 'heygen-avatar-clara',
      }),
    ).toBe('sadtalker');
  });

  it('ignore SadTalker sans photo source, même configuré (GPU dispo)', () => {
    expect(
      selectAvatarProvider({
        plan: 'pro',
        heygenConfigured: true,
        sadTalkerConfigured: true,
        hasSourcePhoto: false,
        avatarId: 'heygen-avatar-clara',
      }),
    ).toBe('heygen');
  });

  it('retombe sur HeyGen si SadTalker non configuré (pas de GPU) et plan payant', () => {
    expect(
      selectAvatarProvider({
        plan: 'business',
        heygenConfigured: true,
        sadTalkerConfigured: false,
        hasSourcePhoto: false,
        avatarId: 'heygen-avatar-marc',
      }),
    ).toBe('heygen');
  });

  it('refuse HeyGen au plan free même si configuré et avatarId choisi', () => {
    expect(
      selectAvatarProvider({
        plan: 'free',
        heygenConfigured: true,
        sadTalkerConfigured: false,
        hasSourcePhoto: false,
        avatarId: 'heygen-avatar-clara',
      }),
    ).toBe('mock');
  });

  it('retombe sur le mock si aucun avatarId choisi (HeyGen inutilisable sans avatar)', () => {
    expect(
      selectAvatarProvider({
        plan: 'business',
        heygenConfigured: true,
        sadTalkerConfigured: false,
        hasSourcePhoto: false,
        avatarId: undefined,
      }),
    ).toBe('mock');
  });

  it('retombe sur le mock si ni SadTalker ni HeyGen ne sont utilisables', () => {
    expect(
      selectAvatarProvider({
        plan: 'free',
        heygenConfigured: false,
        sadTalkerConfigured: false,
        hasSourcePhoto: false,
        avatarId: undefined,
      }),
    ).toBe('mock');
  });
});

describe('renderSadTalkerAvatar — repli si le service est down', () => {
  it('jette une erreur explicite si SADTALKER_BASE_URL absente', async () => {
    setTestEnv();
    await expect(renderSadTalkerAvatar('https://cdn.example/photo.jpg', Buffer.from('audio'))).rejects.toThrow(
      /SADTALKER_BASE_URL/,
    );
  });

  it('jette une erreur avec le statut HTTP si le service répond en erreur (mock fetch échoué)', async () => {
    setTestEnv({ SADTALKER_BASE_URL: 'http://localhost:9500', SADTALKER_HAS_GPU: 'true' });
    const fetchMock = vi.fn(async () => new Response('GPU indisponible', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(renderSadTalkerAvatar('https://cdn.example/photo.jpg', Buffer.from('audio'))).rejects.toThrow(
      /SadTalker 503/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retourne le buffer MP4 brut si le service répond 200', async () => {
    setTestEnv({ SADTALKER_BASE_URL: 'http://localhost:9500', SADTALKER_HAS_GPU: 'true' });
    const fetchMock = vi.fn(async () => new Response(Buffer.from('fake-mp4-bytes'), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await renderSadTalkerAvatar('https://cdn.example/photo.jpg', Buffer.from('audio'));
    expect(result.videoBuffer.toString()).toBe('fake-mp4-bytes');
  });
});
