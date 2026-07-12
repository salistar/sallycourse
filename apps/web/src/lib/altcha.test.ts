import { beforeEach, describe, expect, it } from 'vitest';
import { createAltchaChallenge, verifyAltchaSolution } from './altcha';

// CREDENTIALS_MASTER_KEY doit être un hex 64 caractères (32 octets) — voir
// packages/shared/src/config.ts::masterKeySchema. Valeur de test uniquement.
const TEST_MASTER_KEY = 'a'.repeat(64);

beforeEach(() => {
  process.env.CREDENTIALS_MASTER_KEY = TEST_MASTER_KEY;
});

/** Résout la preuve de travail par force brute (identique à altcha-client.ts, en Node). */
async function bruteForce(salt: string, challenge: string, maxnumber: number): Promise<number> {
  const { createHash } = await import('node:crypto');
  for (let n = 0; n <= maxnumber; n += 1) {
    const hash = createHash('sha256').update(salt + n).digest('hex');
    if (hash === challenge) return n;
  }
  return -1;
}

describe('createAltchaChallenge', () => {
  it('génère un challenge cohérent (sha256(salt+number) === challenge)', async () => {
    const chal = createAltchaChallenge(1000);
    const number = await bruteForce(chal.salt, chal.challenge, chal.maxnumber);
    expect(number).toBeGreaterThanOrEqual(0);
  });

  it('signe le challenge (signature non vide, dépend de la clé secrète)', () => {
    const chal = createAltchaChallenge(1000);
    expect(chal.signature).toHaveLength(64); // hex sha256
    expect(chal.algorithm).toBe('SHA-256');
  });

  it('génère un salt différent à chaque appel', () => {
    const a = createAltchaChallenge(1000);
    const b = createAltchaChallenge(1000);
    expect(a.salt).not.toBe(b.salt);
    expect(a.challenge).not.toBe(b.challenge);
  });
});

describe('verifyAltchaSolution', () => {
  it('accepte une solution correcte', async () => {
    const chal = createAltchaChallenge(1000);
    const number = await bruteForce(chal.salt, chal.challenge, chal.maxnumber);
    const result = verifyAltchaSolution({ ...chal, number });
    expect(result.valid).toBe(true);
  });

  it('rejette un nombre incorrect (preuve de travail invalide)', () => {
    const chal = createAltchaChallenge(1000);
    const result = verifyAltchaSolution({ ...chal, number: 999999 });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/preuve de travail/i);
  });

  it('rejette une signature falsifiée', async () => {
    const chal = createAltchaChallenge(1000);
    const number = await bruteForce(chal.salt, chal.challenge, chal.maxnumber);
    const result = verifyAltchaSolution({ ...chal, number, signature: 'a'.repeat(64) });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/signature/i);
  });

  it('rejette un challenge expiré (salt avec expires dans le passé)', () => {
    const pastSalt = `deadbeef.expires=${Math.floor(Date.now() / 1000) - 60}`;
    const result = verifyAltchaSolution({
      algorithm: 'SHA-256',
      challenge: 'whatever',
      salt: pastSalt,
      number: 0,
      signature: 'whatever',
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/expiré/i);
  });

  it('rejette un salt sans champ expires', () => {
    const result = verifyAltchaSolution({
      algorithm: 'SHA-256',
      challenge: 'whatever',
      salt: 'no-expiry-here',
      number: 0,
      signature: 'whatever',
    });
    expect(result.valid).toBe(false);
  });

  it('rejette des champs manquants', () => {
    const result = verifyAltchaSolution({
      algorithm: 'SHA-256',
      challenge: '',
      salt: '',
      number: 0,
      signature: '',
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/manquants/i);
  });
});
