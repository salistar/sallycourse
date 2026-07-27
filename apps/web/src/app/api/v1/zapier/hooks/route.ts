import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { z } from 'zod';
import { connectDb, Webhook, WEBHOOK_EVENTS } from '@sallycourse/db';
import { requireApiKeyUser } from '@/lib/api-auth';
import { generateWebhookSecret } from '@/lib/webhook-signature';

/**
 * /api/v1/zapier/hooks — conformité REST Hook de Zapier (Prompt 97).
 *
 * Zapier appelle ce endpoint quand un utilisateur active un déclencheur ("Zap")
 * basé sur un événement SallyCourse : POST { event, targetUrl } crée un Webhook
 * interne (réutilise le modèle + la signature HMAC du Prompt 51). Zapier stocke
 * l'`id` renvoyé pour pouvoir se désabonner plus tard via DELETE
 * /api/v1/zapier/hooks/[id].
 *
 * Auth : clé API SallyCourse (Bearer ou X-API-Key), configurée une fois dans
 * l'app Zapier — voir docs/ZAPIER-INTEGRATION.md.
 */

export const dynamic = 'force-dynamic';

const subscribeSchema = z.object({
  event: z.enum(WEBHOOK_EVENTS as unknown as [string, ...string[]]),
  targetUrl: z.string().trim().url(),
});

/** POST — subscribe REST Hook Zapier : crée un Webhook abonné à un seul événement. */
export async function POST(request: Request) {
  const auth = await requireApiKeyUser(request);
  if (auth instanceof Response) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('invalidJson');
  }

  const parsed = subscribeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Données invalides.', code: 'invalidData', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const secret = generateWebhookSecret();

  await connectDb();
  const doc = await Webhook.create({
    userId: auth.userId,
    url: parsed.data.targetUrl,
    events: [parsed.data.event],
    secret,
    active: true,
  });

  // Zapier attend un objet contenant au minimum l'id de l'abonnement créé
  // (convention REST Hook : champ `id`), utilisé ensuite pour le DELETE.
  return NextResponse.json(
    {
      id: String(doc._id),
      event: parsed.data.event,
      targetUrl: doc.url,
    },
    { status: 201 },
  );
}

/** GET — liste les abonnements Zapier (webhooks) du porteur de la clé API. */
export async function GET(request: Request) {
  const auth = await requireApiKeyUser(request);
  if (auth instanceof Response) return auth;

  await connectDb();
  const hooks = await Webhook.find({ userId: auth.userId })
    .select('url events active createdAt')
    .sort({ createdAt: -1 })
    .lean();

  return NextResponse.json({
    hooks: hooks.map((h) => ({
      id: String(h._id),
      targetUrl: h.url,
      events: h.events,
      active: h.active,
      createdAt: h.createdAt,
    })),
  });
}
