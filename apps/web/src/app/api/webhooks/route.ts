import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { z } from 'zod';
import { connectDb, Webhook, WEBHOOK_EVENTS } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { generateWebhookSecret } from '@/lib/webhook-signature';

/**
 * /api/webhooks — gestion des webhooks sortants de l'utilisateur (UI). GET liste
 * les webhooks (le secret n'est renvoyé qu'à la création). POST en crée un et
 * renvoie son secret de signature UNE fois, à conserver côté récepteur pour
 * vérifier la signature HMAC.
 */

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  url: z.string().trim().url(),
  events: z
    .array(z.enum(WEBHOOK_EVENTS as unknown as [string, ...string[]]))
    .min(1)
    .default([...WEBHOOK_EVENTS]),
});

/** GET — webhooks de l'utilisateur (sans secret). */
export async function GET() {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  await connectDb();
  const hooks = await Webhook.find({ userId: user.id })
    .select('url events active createdAt')
    .sort({ createdAt: -1 })
    .lean();

  return NextResponse.json({
    webhooks: hooks.map((h) => ({
      id: String(h._id),
      url: h.url,
      events: h.events,
      active: h.active,
      createdAt: h.createdAt,
    })),
  });
}

/** POST — crée un webhook ; renvoie son secret de signature une seule fois. */
export async function POST(request: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('invalidJson');
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Données invalides.', code: 'invalidData', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const secret = generateWebhookSecret();

  await connectDb();
  const doc = await Webhook.create({
    userId: user.id,
    url: parsed.data.url,
    events: parsed.data.events,
    secret,
    active: true,
  });

  // `secret` : renvoyé ici et NULLE PART ailleurs.
  return NextResponse.json(
    {
      id: String(doc._id),
      url: doc.url,
      events: doc.events,
      active: doc.active,
      secret,
      createdAt: doc.createdAt,
    },
    { status: 201 },
  );
}
