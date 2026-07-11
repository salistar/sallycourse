import { describe, expect, it } from 'vitest';
import {
  generateAffiliateCode,
  generateUniqueAffiliateCode,
  isValidAffiliateCode,
  computeCommissionUsd,
  toApproxUsd,
  affiliateShareUrl,
  DEFAULT_COMMISSION_RATE,
} from './affiliate';

describe('affiliate — génération de code (logique pure)', () => {
  it('génère un code de 8 caractères dans l’alphabet restreint', () => {
    const code = generateAffiliateCode();
    expect(code).toHaveLength(8);
    expect(isValidAffiliateCode(code)).toBe(true);
    // Pas de caractères ambigus (0/O/1/I exclus de l'alphabet — L est conservé).
    expect(code).not.toMatch(/[01OI]/);
  });

  it('génère des codes différents à chaque appel (non déterministe)', () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateAffiliateCode()));
    expect(codes.size).toBeGreaterThan(1);
  });

  it('rejette une chaîne de mauvaise forme', () => {
    expect(isValidAffiliateCode('short')).toBe(false);
    expect(isValidAffiliateCode('01OIZZ00')).toBe(false); // caractères hors alphabet
  });

  it('génère un code unique en évitant les collisions signalées par exists()', async () => {
    let calls = 0;
    const taken = new Set<string>();
    const code = await generateUniqueAffiliateCode(async (c) => {
      calls += 1;
      if (calls < 3) {
        taken.add(c);
        return true; // force une collision simulée les 2 premiers essais
      }
      return taken.has(c);
    });
    expect(isValidAffiliateCode(code)).toBe(true);
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it('jette après maxAttempts si exists() renvoie toujours vrai', async () => {
    await expect(
      generateUniqueAffiliateCode(async () => true, 3),
    ).rejects.toThrow();
  });

  it('construit une URL de partage propre (sans double slash)', () => {
    expect(affiliateShareUrl('https://sallycourse.com/', 'AB23CD45')).toBe(
      'https://sallycourse.com/r/AB23CD45',
    );
    expect(affiliateShareUrl('https://sallycourse.com', 'AB23CD45')).toBe(
      'https://sallycourse.com/r/AB23CD45',
    );
  });
});

describe('affiliate — calcul de commission (logique pure)', () => {
  it('calcule une commission au taux par défaut (20 %)', () => {
    expect(computeCommissionUsd(100, DEFAULT_COMMISSION_RATE)).toBe(20);
  });

  it('arrondit au centime', () => {
    expect(computeCommissionUsd(31.33, 0.2)).toBe(6.27);
  });

  it('retourne 0 pour un montant nul ou négatif', () => {
    expect(computeCommissionUsd(0, 0.2)).toBe(0);
    expect(computeCommissionUsd(-10, 0.2)).toBe(0);
  });

  it('retourne 0 pour un montant non fini', () => {
    expect(computeCommissionUsd(Number.NaN, 0.2)).toBe(0);
    expect(computeCommissionUsd(Number.POSITIVE_INFINITY, 0.2)).toBe(0);
  });

  it('borne un taux hors [0,1] plutôt que de produire un résultat aberrant', () => {
    expect(computeCommissionUsd(100, 5)).toBe(100); // borné à 1
    expect(computeCommissionUsd(100, -1)).toBe(0); // borné à 0
  });

  it('convertit centimes+devise vers USD approximatif', () => {
    expect(toApproxUsd(2900, 'USD')).toBe(29);
    expect(toApproxUsd(2900, 'EUR')).toBeCloseTo(31.32, 2);
    expect(toApproxUsd(29900, 'MAD')).toBeCloseTo(29.9, 2);
  });
});
