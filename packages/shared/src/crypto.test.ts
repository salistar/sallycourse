import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './crypto';

// Clés de test (32 octets hex) — jamais utilisées en dehors de ces tests.
const KEY = 'a'.repeat(64);
const OTHER_KEY = 'b'.repeat(64);

describe('crypto — AES-256-GCM des credentials', () => {
  it('round-trip : déchiffre exactement ce qui a été chiffré', () => {
    const secret = 'mon-mot-de-passe-udemy-éàç-🔐';
    const blob = encryptSecret(secret, KEY);
    expect(blob.startsWith('v1:')).toBe(true);
    expect(decryptSecret(blob, KEY)).toBe(secret);
  });

  it('round-trip : gère la chaîne vide', () => {
    const blob = encryptSecret('', KEY);
    expect(decryptSecret(blob, KEY)).toBe('');
  });

  it('produit des blobs différents à chaque appel (IV aléatoire)', () => {
    expect(encryptSecret('secret', KEY)).not.toBe(encryptSecret('secret', KEY));
  });

  it('jette si la clé maître est malformée (pas 64 hex)', () => {
    expect(() => encryptSecret('secret', 'trop-courte')).toThrow(/64 caractères hexadécimaux/);
    expect(() => decryptSecret('v1:a:b:c', 'zz'.repeat(32))).toThrow(/64 caractères hexadécimaux/);
  });

  it('jette si on déchiffre avec une autre clé', () => {
    const blob = encryptSecret('secret', KEY);
    expect(() => decryptSecret(blob, OTHER_KEY)).toThrow(/clé incorrecte ou blob corrompu/);
  });

  it('jette si le blob est corrompu (données altérées)', () => {
    const blob = encryptSecret('secret', KEY);
    const parts = blob.split(':');
    const data = Buffer.from(parts[3]!, 'base64');
    data[0] = (data[0]! + 1) % 256; // altère le premier octet chiffré
    const corrupted = [parts[0], parts[1], parts[2], data.toString('base64')].join(':');
    expect(() => decryptSecret(corrupted, KEY)).toThrow(/clé incorrecte ou blob corrompu/);
  });

  it('jette si le format du blob est invalide', () => {
    expect(() => decryptSecret('pas-un-blob', KEY)).toThrow(/format attendu/);
    expect(() => decryptSecret('v2:a:b:c', KEY)).toThrow(/Version de blob non supportée/);
  });
});
