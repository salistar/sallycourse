import { describe, expect, it } from 'vitest';
import {
  encryptCredentials,
  decryptCredentials,
  redactCredentials,
} from './platform-credentials';

// Clé de test (32 octets hex) — usage strictement local à ces tests.
const KEY = 'c'.repeat(64);

describe('platform-credentials — (dé)chiffrement du sac de credentials', () => {
  it('round-trip : restitue exactement le sac chiffré', () => {
    const data = { email: 'moi@exemple.com', password: 'Sécr3t-🔐' };
    const blob = encryptCredentials(data, KEY);
    expect(blob.startsWith('v1:')).toBe(true);
    expect(decryptCredentials(blob, KEY)).toEqual(data);
  });

  it('round-trip : gère un sac vide', () => {
    const blob = encryptCredentials({}, KEY);
    expect(decryptCredentials(blob, KEY)).toEqual({});
  });

  it('déchiffrement avec mauvaise clé jette', () => {
    const blob = encryptCredentials({ apiKey: 'abc' }, KEY);
    expect(() => decryptCredentials(blob, 'd'.repeat(64))).toThrow();
  });
});

describe('platform-credentials — redaction', () => {
  it('masque les champs sensibles, conserve les non sensibles', () => {
    const redacted = redactCredentials({
      email: 'moi@exemple.com',
      password: 'p4ss',
      apiKey: 'k-123',
      accessToken: 't-xyz',
      subdomain: 'mon-ecole',
    });
    expect(redacted.email).toBe('moi@exemple.com');
    expect(redacted.subdomain).toBe('mon-ecole');
    expect(redacted.password).toBe('•••');
    expect(redacted.apiKey).toBe('•••');
    expect(redacted.accessToken).toBe('•••');
  });
});
