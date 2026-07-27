import { NextResponse } from 'next/server';
import { WEBHOOK_EVENTS, type WebhookEvent } from '@sallycourse/db';
import { requireApiKeyUser } from '@/lib/api-auth';
import { buildSamplePayload } from '@/lib/zapier-samples';

/**
 * GET /api/v1/zapier/triggers/[event]/sample — exemple de payload pour un
 * déclencheur Zapier donné (Prompt 97). Zapier appelle ce endpoint lors de la
 * configuration d'un Zap pour déduire automatiquement les champs disponibles,
 * sans attendre un événement réel.
 */

export const dynamic = 'force-dynamic';

function isWebhookEvent(value: string): value is WebhookEvent {
  return (WEBHOOK_EVENTS as readonly string[]).includes(value);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ event: string }> },
) {
  const auth = await requireApiKeyUser(request);
  if (auth instanceof Response) return auth;

  const { event } = await params;
  if (!isWebhookEvent(event)) {
    return NextResponse.json(
      { error: `Événement inconnu. Valeurs possibles : ${WEBHOOK_EVENTS.join(', ')}.`, code: 'zapierSampleUnknownEvent', params: { events: WEBHOOK_EVENTS.join(', ') } },
      { status: 404 },
    );
  }

  // Zapier attend un tableau (même à un seul élément) pour ses exemples de trigger.
  return NextResponse.json([buildSamplePayload(event)]);
}
