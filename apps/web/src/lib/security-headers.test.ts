import { describe, expect, it } from 'vitest';
import { applySecurityHeaders, SECURITY_HEADER_NAMES } from './security-headers';

describe('applySecurityHeaders', () => {
  it('pose tous les en-têtes de sécurité attendus', () => {
    const headers = new Headers();
    applySecurityHeaders(headers);

    for (const name of SECURITY_HEADER_NAMES) {
      expect(headers.get(name)).toBeTruthy();
    }
  });

  it('CSP interdit le framing et les objets, et restreint default-src à self', () => {
    const headers = new Headers();
    applySecurityHeaders(headers);
    const csp = headers.get('Content-Security-Policy') ?? '';

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it("X-Frame-Options vaut DENY et X-Content-Type-Options vaut nosniff", () => {
    const headers = new Headers();
    applySecurityHeaders(headers);

    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('Referrer-Policy et Permissions-Policy sont restrictifs', () => {
    const headers = new Headers();
    applySecurityHeaders(headers);

    expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(headers.get('Permissions-Policy')).toContain('camera=()');
    expect(headers.get('Permissions-Policy')).toContain('geolocation=()');
  });

  it('retourne la même instance de Headers (mutation en place)', () => {
    const headers = new Headers();
    const result = applySecurityHeaders(headers);
    expect(result).toBe(headers);
  });
});
