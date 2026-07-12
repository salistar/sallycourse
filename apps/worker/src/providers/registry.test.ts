// Tests de selectProvider (Prompt 151) : sélection OSS/cloud pure, selon
// PROVIDER_MODE, présence de clé cloud et plan utilisateur. Aucun appel
// réseau — uniquement getConfig (env variables en mémoire).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetConfigCache } from '../shared.js';
import { planJustifiesCloud, selectProvider } from './registry.js';

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
  for (const key of ['PROVIDER_MODE']) {
    if (!(key in overrides)) delete process.env[key];
  }
  resetConfigCache();
}

beforeEach(() => setTestEnv());
afterEach(() => resetConfigCache());

describe('planJustifiesCloud', () => {
  it('free (ou plan absent/inconnu) ne justifie jamais le cloud', () => {
    expect(planJustifiesCloud('free')).toBe(false);
    expect(planJustifiesCloud(undefined)).toBe(false);
    expect(planJustifiesCloud(null)).toBe(false);
    expect(planJustifiesCloud('plan-inconnu')).toBe(false);
  });

  it('pro et business justifient le cloud', () => {
    expect(planJustifiesCloud('pro')).toBe(true);
    expect(planJustifiesCloud('business')).toBe(true);
  });
});

describe('selectProvider', () => {
  it("PROVIDER_MODE='oss' force toujours OSS, même avec clé + plan business", () => {
    setTestEnv({ PROVIDER_MODE: 'oss' });
    expect(selectProvider('llm', { hasCloudKey: true, plan: 'business' })).toBe('oss');
  });

  it("PROVIDER_MODE='cloud' force toujours cloud, même sans clé ni plan", () => {
    setTestEnv({ PROVIDER_MODE: 'cloud' });
    expect(selectProvider('tts', { hasCloudKey: false, plan: 'free' })).toBe('cloud');
  });

  it("'auto' (défaut) choisit OSS si aucune clé cloud", () => {
    setTestEnv({ PROVIDER_MODE: 'auto' });
    expect(selectProvider('llm', { hasCloudKey: false, plan: 'business' })).toBe('oss');
  });

  it("'auto' choisit OSS si clé présente mais plan free", () => {
    setTestEnv({ PROVIDER_MODE: 'auto' });
    expect(selectProvider('tts', { hasCloudKey: true, plan: 'free' })).toBe('oss');
  });

  it("'auto' choisit OSS si plan absent (traité comme free, prudent)", () => {
    setTestEnv({ PROVIDER_MODE: 'auto' });
    expect(selectProvider('email', { hasCloudKey: true })).toBe('oss');
  });

  it("'auto' choisit cloud si clé présente ET plan pro", () => {
    setTestEnv({ PROVIDER_MODE: 'auto' });
    expect(selectProvider('llm', { hasCloudKey: true, plan: 'pro' })).toBe('cloud');
  });

  it("'auto' choisit cloud si clé présente ET plan business", () => {
    setTestEnv({ PROVIDER_MODE: 'auto' });
    expect(selectProvider('image', { hasCloudKey: true, plan: 'business' })).toBe('cloud');
  });

  it('sans PROVIDER_MODE explicite, la config retombe sur auto par défaut', () => {
    setTestEnv();
    expect(selectProvider('llm', { hasCloudKey: false, plan: 'business' })).toBe('oss');
    expect(selectProvider('llm', { hasCloudKey: true, plan: 'business' })).toBe('cloud');
  });
});
