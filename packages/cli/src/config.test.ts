import { describe, expect, it } from 'vitest';
import { parseArgs } from './args.js';
import { resolveConfig, normalizeBaseUrl } from './config.js';

describe('normalizeBaseUrl', () => {
  it('retire les slashs finaux', () => {
    expect(normalizeBaseUrl('https://app.tld/')).toBe('https://app.tld');
    expect(normalizeBaseUrl('https://app.tld///')).toBe('https://app.tld');
  });
});

describe('resolveConfig', () => {
  it('priorise les flags sur l\'environnement', () => {
    const args = parseArgs(['--api-url', 'https://flag.tld', '--api-key', 'sk_live_flag']);
    const config = resolveConfig(args, {
      SALLYCOURSE_API_URL: 'https://env.tld',
      SALLYCOURSE_API_KEY: 'sk_live_env',
    } as NodeJS.ProcessEnv);
    expect(config.apiUrl).toBe('https://flag.tld');
    expect(config.apiKey).toBe('sk_live_flag');
  });

  it('retombe sur l\'environnement', () => {
    const args = parseArgs([]);
    const config = resolveConfig(args, {
      SALLYCOURSE_API_URL: 'https://env.tld/',
      SALLYCOURSE_API_KEY: 'sk_live_env',
    } as NodeJS.ProcessEnv);
    expect(config.apiUrl).toBe('https://env.tld');
    expect(config.apiKey).toBe('sk_live_env');
  });

  it('jette si URL ou clé manquante', () => {
    const args = parseArgs([]);
    expect(() => resolveConfig(args, {} as NodeJS.ProcessEnv)).toThrow(/Configuration invalide/);
  });
});
