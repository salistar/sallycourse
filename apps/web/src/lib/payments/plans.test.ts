import { describe, expect, it } from 'vitest';
import { priceFor, isPaidPlan, formatAmount, addOneMonth, PLAN_PRICING } from './plans';

describe('plans — tarification (logique pure)', () => {
  it('reconnaît les plans payants', () => {
    expect(isPaidPlan('pro')).toBe(true);
    expect(isPaidPlan('business')).toBe(true);
    expect(isPaidPlan('free')).toBe(false);
    expect(isPaidPlan('ultra')).toBe(false);
  });

  it('retourne un prix pour un couple plan/devise connu', () => {
    expect(priceFor('pro', 'EUR')).toEqual(PLAN_PRICING.pro.EUR);
    expect(priceFor('business', 'MAD')).toEqual(PLAN_PRICING.business.MAD);
    expect(priceFor('free', 'EUR')).toBeNull();
  });

  it('formate un montant en devise', () => {
    const s = formatAmount({ amountMinor: 29900, currency: 'MAD' }, 'fr-FR');
    // Contient 299 et le code MAD (le séparateur exact dépend de l’ICU).
    expect(s).toMatch(/299/);
    expect(s).toMatch(/MAD/);
  });

  it('addOneMonth avance d’un mois UTC', () => {
    const from = new Date('2026-01-31T00:00:00Z');
    const next = addOneMonth(from);
    // setUTCMonth gère le débordement (31 janv +1 mois → début mars).
    expect(next.getUTCFullYear()).toBe(2026);
    expect(next > from).toBe(true);
  });
});
