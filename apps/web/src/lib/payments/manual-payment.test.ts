import { describe, expect, it } from 'vitest';
import { transitionManualPayment, validateManualPaymentRequest } from './manual-payment';

describe('transitionManualPayment', () => {
  it('pending → approved sur décision "approve"', () => {
    const result = transitionManualPayment({ currentStatus: 'pending', decision: 'approve' });
    expect(result).toEqual({ ok: true, nextStatus: 'approved', reason: expect.any(String) });
  });

  it('pending → rejected sur décision "reject"', () => {
    const result = transitionManualPayment({ currentStatus: 'pending', decision: 'reject' });
    expect(result).toEqual({ ok: true, nextStatus: 'rejected', reason: expect.any(String) });
  });

  it('approved est terminal : re-décider est refusé (approve)', () => {
    const result = transitionManualPayment({ currentStatus: 'approved', decision: 'approve' });
    expect(result.ok).toBe(false);
    expect(result.nextStatus).toBe('approved'); // inchangé
  });

  it('approved est terminal : re-décider est refusé (reject)', () => {
    const result = transitionManualPayment({ currentStatus: 'approved', decision: 'reject' });
    expect(result.ok).toBe(false);
    expect(result.nextStatus).toBe('approved');
  });

  it('rejected est terminal : re-décider est refusé (approve)', () => {
    const result = transitionManualPayment({ currentStatus: 'rejected', decision: 'approve' });
    expect(result.ok).toBe(false);
    expect(result.nextStatus).toBe('rejected');
  });

  it('rejected est terminal : re-décider est refusé (reject)', () => {
    const result = transitionManualPayment({ currentStatus: 'rejected', decision: 'reject' });
    expect(result.ok).toBe(false);
    expect(result.nextStatus).toBe('rejected');
  });
});

describe('validateManualPaymentRequest', () => {
  it('accepte un plan payant, montant positif, devise supportée', () => {
    const result = validateManualPaymentRequest({ plan: 'pro', amountRequested: 2900, currency: 'EUR' });
    expect(result).toEqual({ ok: true, reason: expect.any(String), plan: 'pro', currency: 'EUR' });
  });

  it('rejette un plan non payant (free)', () => {
    const result = validateManualPaymentRequest({ plan: 'free', amountRequested: 100, currency: 'EUR' });
    expect(result.ok).toBe(false);
  });

  it('rejette un plan inconnu', () => {
    const result = validateManualPaymentRequest({ plan: 'inexistant', amountRequested: 100, currency: 'EUR' });
    expect(result.ok).toBe(false);
  });

  it('rejette un montant nul ou négatif', () => {
    expect(validateManualPaymentRequest({ plan: 'pro', amountRequested: 0, currency: 'EUR' }).ok).toBe(false);
    expect(validateManualPaymentRequest({ plan: 'pro', amountRequested: -50, currency: 'EUR' }).ok).toBe(false);
  });

  it('rejette un montant non fini (NaN)', () => {
    expect(validateManualPaymentRequest({ plan: 'pro', amountRequested: NaN, currency: 'EUR' }).ok).toBe(false);
  });

  it('rejette une devise non supportée', () => {
    const result = validateManualPaymentRequest({ plan: 'pro', amountRequested: 2900, currency: 'JPY' });
    expect(result.ok).toBe(false);
  });

  it('accepte toutes les devises listées (EUR/USD/MAD/GBP)', () => {
    for (const currency of ['EUR', 'USD', 'MAD', 'GBP']) {
      expect(validateManualPaymentRequest({ plan: 'business', amountRequested: 9900, currency }).ok).toBe(true);
    }
  });
});
