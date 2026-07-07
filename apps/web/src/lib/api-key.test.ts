import { describe, expect, it } from 'vitest';
import {
  API_KEY_PREFIX,
  apiKeyPrefix,
  generateApiKey,
  hashApiKey,
  looksLikeApiKey,
  verifyApiKey,
} from './api-key';

describe('api-key', () => {
  it('génère une clé au format attendu avec hash et préfixe cohérents', () => {
    const { key, hashedKey, prefix } = generateApiKey();
    expect(key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(hashedKey).toBe(hashApiKey(key));
    expect(prefix).toBe(apiKeyPrefix(key));
    // Hash SHA-256 hex = 64 caractères.
    expect(hashedKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produit des clés uniques', () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.key).not.toBe(b.key);
    expect(a.hashedKey).not.toBe(b.hashedKey);
  });

  it('vérifie une clé valide contre son hash', () => {
    const { key, hashedKey } = generateApiKey();
    expect(verifyApiKey(key, hashedKey)).toBe(true);
  });

  it('rejette une clé incorrecte', () => {
    const { hashedKey } = generateApiKey();
    const other = generateApiKey();
    expect(verifyApiKey(other.key, hashedKey)).toBe(false);
  });

  it('rejette une clé altérée', () => {
    const { key, hashedKey } = generateApiKey();
    expect(verifyApiKey(`${key}x`, hashedKey)).toBe(false);
  });

  it('reconnaît la forme d’une clé SallyCourse', () => {
    const { key } = generateApiKey();
    expect(looksLikeApiKey(key)).toBe(true);
    expect(looksLikeApiKey('random-token')).toBe(false);
    expect(looksLikeApiKey(API_KEY_PREFIX)).toBe(false);
  });
});
