import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { getConfig } from '@sallycourse/shared';
import {
  verifyPaddleSignature,
  verifyLemonSqueezySignature,
  interpretPaddleEvent,
  interpretLemonSqueezyEvent,
  type WebhookIntent,
} from '@/lib/payments/paddle';
import { activatePlan, deactivateSubscription } from '@/lib/payments/plans';
import { logger } from '@/lib/logger';

/**
 * POST /api/payments/paddle/webhook — webhook des prestataires internationaux
 * (Paddle Billing et Lemon Squeezy, partagent cette route). On lit le corps
 * BRUT, on vérifie la signature du prestataire détecté via ses en-têtes, puis
 * on applique l'intention (activate/deactivate/ignore). Idempotent : le rejeu
 * d'un événement ne double pas l'abonnement (clé = providerRef).
 *
 * Secrets attendus dans la config :
 *  - Paddle : PADDLE_WEBHOOK_SECRET (+ en-tête `Paddle-Signature`).
 *  - Lemon  : réutilise PADDLE_WEBHOOK_SECRET si présent (+ en-tête `X-Signature`).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Applique l'intention décodée du webhook (I/O DB). */
async function applyIntent(intent: WebhookIntent, provider: 'paddle' | 'lemonsqueezy') {
  if (intent.action === 'activate') {
    await activatePlan({
      userId: intent.userId,
      plan: intent.plan,
      provider,
      providerRef: intent.providerRef,
      currentPeriodEnd: intent.currentPeriodEnd,
    });
    return;
  }
  if (intent.action === 'deactivate') {
    await deactivateSubscription(provider, intent.providerRef, intent.status);
  }
}

export async function POST(request: Request) {
  const secret = getConfig().PADDLE_WEBHOOK_SECRET;
  if (!secret) {
    logger.warn('Webhook paiement reçu mais aucun secret configuré');
    return NextResponse.json({ error: 'Webhook non configuré.', code: 'webhookNotConfigured' }, { status: 503 });
  }

  // Corps brut obligatoire : la signature couvre les octets exacts reçus.
  const rawBody = await request.text();
  const paddleSig = request.headers.get('paddle-signature');
  const lemonSig = request.headers.get('x-signature');

  let intent: WebhookIntent;
  let provider: 'paddle' | 'lemonsqueezy';

  if (paddleSig) {
    if (!verifyPaddleSignature(rawBody, secret, paddleSig)) {
      logger.warn('Webhook Paddle : signature invalide');
      return apiError('invalidSignature');
    }
    provider = 'paddle';
    intent = interpretPaddleEvent(safeJson(rawBody));
  } else if (lemonSig) {
    if (!verifyLemonSqueezySignature(rawBody, secret, lemonSig)) {
      logger.warn('Webhook Lemon Squeezy : signature invalide');
      return apiError('invalidSignature');
    }
    provider = 'lemonsqueezy';
    intent = interpretLemonSqueezyEvent(safeJson(rawBody));
  } else {
    return NextResponse.json({ error: 'En-tête de signature absent.', code: 'signatureHeaderMissing' }, { status: 400 });
  }

  try {
    await applyIntent(intent, provider);
  } catch (err) {
    logger.error({ err, provider }, 'Webhook paiement : application échouée');
    return NextResponse.json({ error: 'Traitement échoué.', code: 'processingFailed' }, { status: 500 });
  }

  return NextResponse.json({ received: true, action: intent.action }, { status: 200 });
}

/** Parse JSON en tolérant l'échec (retourne null plutôt que jeter). */
function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
