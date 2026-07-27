import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { z } from 'zod';
import { connectDb, PushSubscription } from '@sallycourse/db';
import { getConfig } from '@sallycourse/shared';
import { requireApiUser } from '@/lib/session';

/**
 * /api/notifications/push-subscribe — Web Push natif (Prompt 156, session-auth).
 * POST : enregistre (ou met à jour) l'abonnement PushManager du navigateur de
 * l'utilisateur connecté. GET : expose la clé publique VAPID nécessaire à
 * PushManager.subscribe() côté client (pas de secret exposé — la clé publique
 * est faite pour circuler). DELETE : désabonne (endpoint fourni en query).
 */

export const dynamic = 'force-dynamic';

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

/** GET — clé publique VAPID (pour applicationServerKey côté navigateur). */
export async function GET() {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const config = getConfig();
  return NextResponse.json({
    publicKey: config.VAPID_PUBLIC_KEY ?? null,
    enabled: Boolean(config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY),
  });
}

/** POST — enregistre l'abonnement (upsert par endpoint, jamais deux fois le même). */
export async function POST(request: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('invalidJson');
  }

  const parsed = subscribeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Abonnement invalide (endpoint/keys.p256dh/keys.auth requis).', code: 'invalidPushSubscription', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectDb();

  const userAgent = request.headers.get('user-agent')?.slice(0, 300);

  // Upsert par endpoint : un même navigateur peut re-souscrire (rotation de
  // clé côté push service) sans créer de doublon ; réassigne userId si un
  // autre compte avait souscrit ce même endpoint (ex: navigateur partagé).
  await PushSubscription.findOneAndUpdate(
    { endpoint: parsed.data.endpoint },
    {
      $set: {
        userId: user.id,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        userAgent,
      },
    },
    { upsert: true, setDefaultsOnInsert: true },
  );

  return NextResponse.json({ ok: true }, { status: 201 });
}

const unsubscribeSchema = z.object({ endpoint: z.string().url() });

/** DELETE — désabonne (retire l'endpoint fourni pour l'utilisateur courant). */
export async function DELETE(request: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('invalidJson');
  }

  const parsed = unsubscribeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'endpoint requis.', code: 'endpointRequired' }, { status: 400 });
  }

  await connectDb();
  const res = await PushSubscription.deleteOne({ endpoint: parsed.data.endpoint, userId: user.id });

  return NextResponse.json({ deleted: res.deletedCount ?? 0 });
}
