import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  parsePaddleSignature,
  verifyPaddleSignature,
  verifyLemonSqueezySignature,
  interpretPaddleEvent,
  interpretLemonSqueezyEvent,
} from './paddle';

const secret = 'whsec_test_secret';

/** Signe un corps « à la Paddle » (ts:body) pour les tests. */
function paddleHeader(rawBody: string, ts: number): string {
  const h1 = createHmac('sha256', secret).update(`${ts}:${rawBody}`, 'utf8').digest('hex');
  return `ts=${ts};h1=${h1}`;
}

describe('Paddle — signature', () => {
  const body = JSON.stringify({ event_type: 'transaction.completed', data: { id: 'txn_1' } });

  it('parse un en-tête ts=..;h1=..', () => {
    const ts = 1_700_000_000;
    const parsed = parsePaddleSignature(paddleHeader(body, ts));
    expect(parsed?.ts).toBe(ts);
    expect(parsed?.h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepte une signature valide et récente', () => {
    const ts = Math.floor(Date.now() / 1000);
    expect(verifyPaddleSignature(body, secret, paddleHeader(body, ts))).toBe(true);
  });

  it('rejette un corps altéré, un mauvais secret et un en-tête malformé', () => {
    const ts = Math.floor(Date.now() / 1000);
    const header = paddleHeader(body, ts);
    expect(verifyPaddleSignature(`${body} `, secret, header)).toBe(false);
    expect(verifyPaddleSignature(body, 'other', header)).toBe(false);
    expect(verifyPaddleSignature(body, secret, 'garbage')).toBe(false);
  });

  it('applique la tolérance anti-rejeu', () => {
    const oldTs = Math.floor(Date.now() / 1000) - 10_000;
    const header = paddleHeader(body, oldTs);
    expect(verifyPaddleSignature(body, secret, header)).toBe(false); // hors 300 s
    expect(verifyPaddleSignature(body, secret, header, 0)).toBe(true); // contrôle désactivé
  });
});

describe('Lemon Squeezy — signature', () => {
  const body = JSON.stringify({ meta: { event_name: 'subscription_created' } });

  it('accepte une signature hex valide et rejette le reste', () => {
    const sig = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
    expect(verifyLemonSqueezySignature(body, secret, sig)).toBe(true);
    expect(verifyLemonSqueezySignature(body, secret, sig.replace(/.$/, '0'))).toBe(false);
    expect(verifyLemonSqueezySignature(`${body} `, secret, sig)).toBe(false);
  });
});

describe('Paddle — interprétation des événements', () => {
  const userId = 'a'.repeat(24);

  it('active sur transaction.completed avec custom_data valide', () => {
    const intent = interpretPaddleEvent({
      event_type: 'transaction.completed',
      data: {
        subscription_id: 'sub_9',
        custom_data: { userId, plan: 'pro' },
        current_billing_period: { ends_at: '2026-08-07T00:00:00Z' },
      },
    });
    expect(intent).toMatchObject({ action: 'activate', userId, plan: 'pro', providerRef: 'sub_9' });
    if (intent.action === 'activate') {
      expect(intent.currentPeriodEnd?.toISOString()).toBe('2026-08-07T00:00:00.000Z');
    }
  });

  it('ignore si custom_data manque ou plan inconnu', () => {
    expect(interpretPaddleEvent({ event_type: 'transaction.completed', data: { id: 'x' } }).action).toBe('ignore');
    expect(
      interpretPaddleEvent({
        event_type: 'transaction.completed',
        data: { id: 'x', custom_data: { userId, plan: 'ultra' } },
      }).action,
    ).toBe('ignore');
  });

  it('désactive sur annulation et past_due', () => {
    expect(
      interpretPaddleEvent({ event_type: 'subscription.canceled', data: { subscription_id: 's' } }),
    ).toEqual({ action: 'deactivate', providerRef: 's', status: 'canceled' });
    expect(
      interpretPaddleEvent({ event_type: 'subscription.past_due', data: { subscription_id: 's' } }),
    ).toEqual({ action: 'deactivate', providerRef: 's', status: 'past_due' });
  });
});

describe('Lemon Squeezy — interprétation des événements', () => {
  const userId = 'b'.repeat(24);

  it('active sur subscription_created', () => {
    const intent = interpretLemonSqueezyEvent({
      meta: { event_name: 'subscription_created', custom_data: { userId, plan: 'business' } },
      data: { id: 'ls_42', attributes: { renews_at: '2026-08-07T00:00:00Z' } },
    });
    expect(intent).toMatchObject({ action: 'activate', userId, plan: 'business', providerRef: 'ls_42' });
  });

  it('expire sur subscription_expired', () => {
    expect(
      interpretLemonSqueezyEvent({ meta: { event_name: 'subscription_expired' }, data: { id: 'ls_1' } }),
    ).toEqual({ action: 'deactivate', providerRef: 'ls_1', status: 'expired' });
  });
});
