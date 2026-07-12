import { describe, expect, it } from 'vitest';
import { resolveEmailChannel } from './send';

// Tests de resolveEmailChannel (P156) : sélection SMTP(OSS)/Resend(cloud)/mock
// selon PROVIDER_MODE — logique pure, aucun envoi réseau. Même règle que
// apps/worker/src/providers/registry.ts::selectProvider (dupliquée ici en
// pur, packages/db ne pouvant pas dépendre du worker).

const RESEND = { RESEND_API_KEY: 'resend_test_key' };
const SMTP = { SMTP_URL: 'smtp://mailpit:1025' };
const BOTH = { ...RESEND, ...SMTP };

describe('resolveEmailChannel — PROVIDER_MODE=oss', () => {
  it('choisit toujours smtp, même si une clé Resend est configurée', () => {
    expect(resolveEmailChannel({ ...BOTH, PROVIDER_MODE: 'oss' }, 'business')).toBe('smtp');
  });

  it('retombe sur mock si ni SMTP_URL ni RESEND_API_KEY ne sont présents', () => {
    expect(resolveEmailChannel({ PROVIDER_MODE: 'oss' })).toBe('mock');
  });
});

describe('resolveEmailChannel — PROVIDER_MODE=cloud', () => {
  it('choisit resend si la clé est présente', () => {
    expect(resolveEmailChannel({ ...BOTH, PROVIDER_MODE: 'cloud' })).toBe('resend');
  });

  it('retombe sur smtp si RESEND_API_KEY est absente', () => {
    expect(resolveEmailChannel({ ...SMTP, PROVIDER_MODE: 'cloud' })).toBe('smtp');
  });
});

describe('resolveEmailChannel — PROVIDER_MODE=auto (défaut)', () => {
  it('choisit smtp si le plan est free, même avec une clé Resend présente', () => {
    expect(resolveEmailChannel({ ...BOTH, PROVIDER_MODE: 'auto' }, 'free')).toBe('smtp');
  });

  it('choisit smtp si le plan est absent (traité comme free, prudent)', () => {
    expect(resolveEmailChannel({ ...BOTH, PROVIDER_MODE: 'auto' })).toBe('smtp');
  });

  it('choisit resend si le plan justifie le cloud (pro) ET la clé est présente', () => {
    expect(resolveEmailChannel({ ...BOTH, PROVIDER_MODE: 'auto' }, 'pro')).toBe('resend');
  });

  it('choisit resend si le plan est business ET la clé est présente', () => {
    expect(resolveEmailChannel({ ...BOTH, PROVIDER_MODE: 'auto' }, 'business')).toBe('resend');
  });

  it('choisit smtp si le plan justifie le cloud mais aucune clé Resend n’est configurée', () => {
    expect(resolveEmailChannel({ ...SMTP, PROVIDER_MODE: 'auto' }, 'business')).toBe('smtp');
  });
});

describe('resolveEmailChannel — sans PROVIDER_MODE explicite', () => {
  it('retombe sur la règle auto par défaut', () => {
    expect(resolveEmailChannel({ ...BOTH }, 'free')).toBe('smtp');
    expect(resolveEmailChannel({ ...BOTH }, 'business')).toBe('resend');
  });
});

describe('resolveEmailChannel — aucune configuration', () => {
  it('retombe sur mock (jamais bloquant)', () => {
    expect(resolveEmailChannel({})).toBe('mock');
  });
});
