// Tests de withRetry : succès immédiat, réussite après échecs, épuisement.
// + verifyExpectedDomain (P126 — garde anti-phishing avant saisie credentials).
import { describe, expect, it, vi } from 'vitest';
import { withRetry, verifyExpectedDomain, UnexpectedDomainError } from './base-adapter.js';

describe('withRetry', () => {
  it('retourne le résultat sans réessai quand fn réussit du premier coup', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withRetry(fn, { attempts: 3 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('réessaie puis réussit avant épuisement des tentatives', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom 1'))
      .mockRejectedValueOnce(new Error('boom 2'))
      .mockResolvedValue('ok');
    await expect(withRetry(fn, { attempts: 3, baseDelayMs: 0 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('relance la dernière erreur après épuisement des tentatives', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('toujours ko'));
    await expect(withRetry(fn, { attempts: 3, baseDelayMs: 0 })).rejects.toThrow('toujours ko');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('ramène attempts ≤ 0 à un unique essai', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('ko'));
    await expect(withRetry(fn, { attempts: 0, baseDelayMs: 0 })).rejects.toThrow('ko');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('emballe une erreur non-Error dans un Error après épuisement', async () => {
    const fn = vi.fn().mockRejectedValue('chaine brute');
    await expect(withRetry(fn, { attempts: 1, baseDelayMs: 0, label: 'op' })).rejects.toThrow(Error);
  });
});

describe('verifyExpectedDomain', () => {
  it('accepte un domaine exact', () => {
    expect(() => verifyExpectedDomain('https://www.udemy.com/join/login-popup/', 'udemy.com')).not.toThrow();
  });

  it('accepte un sous-domaine strict du domaine attendu', () => {
    expect(() => verifyExpectedDomain('https://app.kajabi.com/login', 'kajabi.com')).not.toThrow();
  });

  it('est insensible à la casse', () => {
    expect(() => verifyExpectedDomain('https://APP.Kajabi.COM/login', 'kajabi.com')).not.toThrow();
  });

  it('refuse un domaine totalement différent (phishing basique)', () => {
    expect(() => verifyExpectedDomain('https://udemy-secure-login.example.com/', 'udemy.com')).toThrow(
      UnexpectedDomainError,
    );
  });

  it('refuse un domaine qui contient le domaine attendu sans être un sous-domaine (ex. domaine.tld.evil.com)', () => {
    expect(() => verifyExpectedDomain('https://kajabi.com.evil.example/login', 'kajabi.com')).toThrow(
      UnexpectedDomainError,
    );
  });

  it('refuse une URL invalide', () => {
    expect(() => verifyExpectedDomain('not-a-url', 'udemy.com')).toThrow(UnexpectedDomainError);
  });
});
