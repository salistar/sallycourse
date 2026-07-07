import { connectDb, Webhook, type WebhookEvent } from '@sallycourse/db';
import { logger } from '@/lib/logger';
import { buildSignatureHeader, EVENT_HEADER, SIGNATURE_HEADER } from '@/lib/webhook-signature';

/**
 * Émission des webhooks sortants signés (Prompt 51). Appelé aux transitions du
 * cycle de vie d'un cours : outline_ready, generation_complete, deployed,
 * review_approved. Chaque abonnement reçoit un POST JSON signé HMAC-SHA256 avec
 * son propre secret (en-tête X-SallyCourse-Signature).
 *
 * L'émission est best-effort et non bloquante : un webhook injoignable est
 * journalisé mais n'interrompt jamais le flux métier appelant.
 */

export interface WebhookPayload {
  /** Nom de l'événement (identique à l'en-tête X-SallyCourse-Event). */
  event: WebhookEvent;
  /** Instant d'émission (epoch ms). */
  timestamp: number;
  /** Données de l'événement (ids, statut, url…). */
  data: Record<string, unknown>;
}

/** Construit le corps JSON canonique signé et envoyé. */
export function buildWebhookBody(
  event: WebhookEvent,
  data: Record<string, unknown>,
): { body: string; payload: WebhookPayload } {
  const payload: WebhookPayload = { event, timestamp: Date.now(), data };
  return { body: JSON.stringify(payload), payload };
}

/** Envoie un webhook unique (signé) — best-effort, ne jette pas. */
async function deliver(
  url: string,
  secret: string,
  event: WebhookEvent,
  body: string,
): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [SIGNATURE_HEADER]: buildSignatureHeader(body, secret),
        [EVENT_HEADER]: event,
      },
      body,
      // Un récepteur lent ne doit pas bloquer indéfiniment le producteur.
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.warn({ url, event, status: res.status }, 'webhook non-2xx');
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ url, event, err: String(err) }, 'webhook injoignable');
    return false;
  }
}

/**
 * Diffuse un événement à tous les webhooks actifs de l'utilisateur abonnés à
 * cet événement. Résout après tentative sur tous les abonnés ; n'attend pas de
 * garantie de livraison (fire-and-forget côté appelant possible).
 */
export async function dispatchWebhook(
  userId: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
): Promise<{ delivered: number; total: number }> {
  await connectDb();

  const hooks = await Webhook.find({ userId, active: true, events: event })
    .select('url secret')
    .lean();
  if (hooks.length === 0) return { delivered: 0, total: 0 };

  const { body } = buildWebhookBody(event, data);
  const results = await Promise.all(
    hooks.map((h) => deliver(h.url, h.secret, event, body)),
  );
  const delivered = results.filter(Boolean).length;
  return { delivered, total: hooks.length };
}
