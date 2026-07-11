import { describe, expect, it } from 'vitest';
import { convertAmount, getRate, FX_RATES_PER_USD } from './fx-rates';

describe('fx-rates', () => {
  it('renvoie 1 pour une conversion vers la même devise', () => {
    expect(getRate('EUR', 'EUR')).toBe(1);
    expect(convertAmount(42, 'MAD', 'MAD')).toBe(42);
  });

  it('convertit EUR → USD selon le taux fixe (≈1.08)', () => {
    const result = convertAmount(100, 'EUR', 'USD');
    expect(result).toBeCloseTo(108, 0);
  });

  it('convertit MAD → USD selon le taux fixe (≈0.10)', () => {
    const result = convertAmount(100, 'MAD', 'USD');
    expect(result).toBeCloseTo(10, 0);
  });

  it('convertit via le pivot USD pour une paire non-USD (EUR → MAD)', () => {
    // 100 EUR ≈ 108 USD ≈ 1080 MAD.
    const result = convertAmount(100, 'EUR', 'MAD');
    expect(result).toBeCloseTo(1080, -1);
  });

  it('accepte une table de taux injectée (pour test/repli API)', () => {
    const customRates = { ...FX_RATES_PER_USD, EUR: 1 };
    // Avec ce taux custom, 1 USD = 1 EUR.
    expect(convertAmount(50, 'USD', 'EUR', customRates)).toBe(50);
  });
});
