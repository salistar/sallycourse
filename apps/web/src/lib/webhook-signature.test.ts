import { describe, expect, it } from 'vitest';
import {
  buildSignatureHeader,
  computeSignature,
  generateWebhookSecret,
  parseSignatureHeader,
  signedPayload,
  verifySignature,
} from './webhook-signature';

describe('webhook-signature', () => {
  const secret = generateWebhookSecret();
  const payload = JSON.stringify({ event: 'deployed', data: { courseId: 'abc' } });

  it('génère un secret hex de 64 caractères', () => {
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('lie la signature au timestamp et au payload', () => {
    const ts = 1_700_000_000;
    expect(signedPayload(payload, ts)).toBe(`${ts}.${payload}`);
    const sigA = computeSignature(payload, secret, ts);
    const sigB = computeSignature(payload, secret, ts + 1);
    expect(sigA).not.toBe(sigB); // timestamp différent → signature différente
  });

  it('construit et parse un en-tête t=..,v1=..', () => {
    const ts = 1_700_000_000;
    const header = buildSignatureHeader(payload, secret, ts);
    const parsed = parseSignatureHeader(header);
    expect(parsed).toEqual({
      timestamp: ts,
      signature: computeSignature(payload, secret, ts),
    });
  });

  it('vérifie une signature valide', () => {
    const header = buildSignatureHeader(payload, secret);
    expect(verifySignature(payload, secret, header)).toBe(true);
  });

  it('rejette un mauvais secret', () => {
    const header = buildSignatureHeader(payload, secret);
    expect(verifySignature(payload, generateWebhookSecret(), header)).toBe(false);
  });

  it('rejette un payload altéré', () => {
    const header = buildSignatureHeader(payload, secret);
    expect(verifySignature(`${payload} `, secret, header)).toBe(false);
  });

  it('rejette un en-tête malformé', () => {
    expect(verifySignature(payload, secret, 'garbage')).toBe(false);
    expect(parseSignatureHeader('garbage')).toBeNull();
  });

  it('applique la tolérance temporelle anti-rejeu', () => {
    const oldTs = Math.floor(Date.now() / 1000) - 10_000;
    const header = buildSignatureHeader(payload, secret, oldTs);
    // Hors tolérance par défaut (300 s) → rejeté.
    expect(verifySignature(payload, secret, header)).toBe(false);
    // Tolérance désactivée (0) → accepté malgré l'ancienneté.
    expect(verifySignature(payload, secret, header, 0)).toBe(true);
  });
});
