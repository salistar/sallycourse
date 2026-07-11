import { describe, expect, it } from 'vitest';
import { isCsrfSuspicious } from './csrf';

const APP_ORIGIN = 'https://sallycourse.app';

function req(opts: {
  method: string;
  pathname: string;
  origin?: string;
  referer?: string;
}): { method: string; nextUrl: { pathname: string; origin: string }; headers: Headers } {
  const headers = new Headers();
  if (opts.origin) headers.set('origin', opts.origin);
  if (opts.referer) headers.set('referer', opts.referer);
  return {
    method: opts.method,
    nextUrl: { pathname: opts.pathname, origin: APP_ORIGIN },
    headers,
  };
}

describe('isCsrfSuspicious', () => {
  it('laisse passer GET/HEAD/OPTIONS quelle que soit l’origine', () => {
    expect(
      isCsrfSuspicious(req({ method: 'GET', pathname: '/api/courses', origin: 'https://evil.example' })),
    ).toBe(false);
  });

  it('bloque un POST avec une Origin différente (CSRF cross-site)', () => {
    expect(
      isCsrfSuspicious(
        req({ method: 'POST', pathname: '/api/account/delete', origin: 'https://evil.example' }),
      ),
    ).toBe(true);
  });

  it('laisse passer un POST avec la même Origin', () => {
    expect(
      isCsrfSuspicious(req({ method: 'POST', pathname: '/api/account/delete', origin: APP_ORIGIN })),
    ).toBe(false);
  });

  it('retombe sur Referer si Origin est absent', () => {
    expect(
      isCsrfSuspicious(
        req({ method: 'DELETE', pathname: '/api/webhooks/abc', referer: 'https://evil.example/page' }),
      ),
    ).toBe(true);
    expect(
      isCsrfSuspicious(
        req({ method: 'DELETE', pathname: '/api/webhooks/abc', referer: `${APP_ORIGIN}/dashboard` }),
      ),
    ).toBe(false);
  });

  it('exempte les webhooks de paiement tiers (protégés par signature)', () => {
    expect(
      isCsrfSuspicious(
        req({
          method: 'POST',
          pathname: '/api/payments/paddle/webhook',
          origin: 'https://paddle.example',
        }),
      ),
    ).toBe(false);
    expect(
      isCsrfSuspicious(
        req({
          method: 'POST',
          pathname: '/api/payments/cmi/callback',
          origin: 'https://cmi.example',
        }),
      ),
    ).toBe(false);
  });

  it('exempte /api/auth (CSRF géré nativement par NextAuth)', () => {
    expect(
      isCsrfSuspicious(
        req({ method: 'POST', pathname: '/api/auth/callback/google', origin: 'https://evil.example' }),
      ),
    ).toBe(false);
  });

  it('n’est pas suspicieux sans Origin ni Referer (clients API/ApiKey)', () => {
    expect(isCsrfSuspicious(req({ method: 'POST', pathname: '/api/v1/courses' }))).toBe(false);
  });
});
