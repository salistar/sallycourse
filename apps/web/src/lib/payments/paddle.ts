import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Webhooks Paddle (Billing) & Lemon Squeezy — fallback international (P54).
 *
 * Aucun SDK : on vérifie la signature du webhook à la main puis on mappe
 * l'événement vers une activation/désactivation de plan. Logique PURE (signature
 * + parsing) — l'I/O (DB) reste dans le route handler.
 *
 *  - Paddle Billing : en-tête `Paddle-Signature: ts=<unix>;h1=<hmac hex>` ;
 *    base signée = `<ts>:<rawBody>` ; HMAC-SHA256 avec le secret du webhook.
 *  - Lemon Squeezy : en-tête `X-Signature: <hmac hex>` ; base = rawBody brut ;
 *    HMAC-SHA256 avec le secret du store.
 */

/** Compare deux hex en temps constant (longueurs égales requises). */
function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Paddle Billing                                                      */
/* ------------------------------------------------------------------ */

/** Parse `ts=<unix>;h1=<hmac>` → { ts, h1 } ; null si malformé. */
export function parsePaddleSignature(
  header: string,
): { ts: number; h1: string } | null {
  let ts: number | undefined;
  let h1: string | undefined;
  for (const part of header.split(';')) {
    const [key, value] = part.split('=');
    if (key === 'ts' && value) ts = Number(value);
    if (key === 'h1' && value) h1 = value.trim();
  }
  if (ts === undefined || Number.isNaN(ts) || !h1) return null;
  return { ts, h1 };
}

/**
 * Vérifie une signature Paddle Billing. `rawBody` doit être le corps EXACT
 * reçu (jamais re-sérialisé). `toleranceSec` borne l'âge accepté (anti-rejeu) ;
 * 0 désactive le contrôle temporel.
 */
export function verifyPaddleSignature(
  rawBody: string,
  secret: string,
  header: string,
  toleranceSec = 300,
): boolean {
  const parsed = parsePaddleSignature(header);
  if (!parsed) return false;

  if (toleranceSec > 0) {
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parsed.ts) > toleranceSec) return false;
  }

  const expected = createHmac('sha256', secret)
    .update(`${parsed.ts}:${rawBody}`, 'utf8')
    .digest('hex');
  return safeEqualHex(expected, parsed.h1);
}

/* ------------------------------------------------------------------ */
/* Lemon Squeezy                                                       */
/* ------------------------------------------------------------------ */

/**
 * Vérifie une signature Lemon Squeezy : `X-Signature` = HMAC-SHA256 hex du
 * corps brut avec le secret de signature du store.
 */
export function verifyLemonSqueezySignature(
  rawBody: string,
  secret: string,
  signatureHex: string,
): boolean {
  const expected = createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('hex');
  return safeEqualHex(expected, signatureHex.trim());
}

/* ------------------------------------------------------------------ */
/* Mapping des événements → intention d'activation                     */
/* ------------------------------------------------------------------ */

import type { PaidPlanId } from './plans';
import { isPaidPlan } from './plans';

export type WebhookIntent =
  | {
      action: 'activate';
      userId: string;
      plan: PaidPlanId;
      providerRef: string;
      currentPeriodEnd?: Date;
    }
  | { action: 'deactivate'; providerRef: string; status: 'canceled' | 'expired' | 'past_due' }
  | { action: 'ignore'; reason: string };

/**
 * Extrait de façon défensive une valeur imbriquée par chemin pointé
 * (« data.subscription_id ») dans un objet inconnu. Retourne undefined si
 * absente/typée autrement.
 */
function pick(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * Interprète un événement Paddle Billing déjà parsé (JSON). On attend que le
 * `userId` et le `plan` SallyCourse soient passés via custom_data (défini au
 * moment du checkout) — c'est le mécanisme officiel Paddle pour lier une
 * transaction à un utilisateur applicatif.
 */
export function interpretPaddleEvent(event: unknown): WebhookIntent {
  const type = asString(pick(event, 'event_type')) ?? '';
  const providerRef =
    asString(pick(event, 'data.subscription_id')) ?? asString(pick(event, 'data.id')) ?? '';

  if (!providerRef) return { action: 'ignore', reason: 'Référence prestataire absente.' };

  // Activation sur transaction/abonnement effectif.
  if (type === 'transaction.completed' || type === 'subscription.activated') {
    const userId = asString(pick(event, 'data.custom_data.userId'));
    const plan = asString(pick(event, 'data.custom_data.plan'));
    if (!userId || !plan || !isPaidPlan(plan)) {
      return { action: 'ignore', reason: 'custom_data.userId/plan manquant ou invalide.' };
    }
    const end = asString(pick(event, 'data.current_billing_period.ends_at'));
    return {
      action: 'activate',
      userId,
      plan,
      providerRef,
      currentPeriodEnd: end ? new Date(end) : undefined,
    };
  }

  if (type === 'subscription.canceled' || type === 'subscription.paused') {
    return { action: 'deactivate', providerRef, status: 'canceled' };
  }
  if (type === 'subscription.past_due') {
    return { action: 'deactivate', providerRef, status: 'past_due' };
  }

  return { action: 'ignore', reason: `Événement non géré : ${type || '(inconnu)'}.` };
}

/**
 * Interprète un événement Lemon Squeezy. Le lien vers l'utilisateur applicatif
 * passe par `meta.custom_data` (userId + plan), défini à la création du
 * checkout.
 */
export function interpretLemonSqueezyEvent(event: unknown): WebhookIntent {
  const name = asString(pick(event, 'meta.event_name')) ?? '';
  const providerRef = asString(pick(event, 'data.id')) ?? '';
  if (!providerRef) return { action: 'ignore', reason: 'Référence prestataire absente.' };

  if (name === 'subscription_created' || name === 'subscription_payment_success') {
    const userId = asString(pick(event, 'meta.custom_data.userId'));
    const plan = asString(pick(event, 'meta.custom_data.plan'));
    if (!userId || !plan || !isPaidPlan(plan)) {
      return { action: 'ignore', reason: 'meta.custom_data.userId/plan manquant ou invalide.' };
    }
    const end = asString(pick(event, 'data.attributes.renews_at'));
    return {
      action: 'activate',
      userId,
      plan,
      providerRef,
      currentPeriodEnd: end ? new Date(end) : undefined,
    };
  }

  if (name === 'subscription_cancelled' || name === 'subscription_expired') {
    return { action: 'deactivate', providerRef, status: name === 'subscription_expired' ? 'expired' : 'canceled' };
  }

  return { action: 'ignore', reason: `Événement non géré : ${name || '(inconnu)'}.` };
}
