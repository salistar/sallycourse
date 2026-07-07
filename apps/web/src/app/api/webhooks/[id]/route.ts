import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { connectDb, Webhook, WEBHOOK_EVENTS } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';

/**
 * /api/webhooks/[id] — mise à jour (PATCH : activer/désactiver, changer les
 * événements ou l'URL) et suppression (DELETE) d'un webhook de l'utilisateur.
 * Le secret n'est jamais modifié ni renvoyé ici.
 */

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  url: z.string().trim().url().optional(),
  events: z
    .array(z.enum(WEBHOOK_EVENTS as unknown as [string, ...string[]]))
    .min(1)
    .optional(),
  active: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: 'Webhook introuvable.' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Données invalides.', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectDb();
  const doc = await Webhook.findOneAndUpdate(
    { _id: id, userId: user.id },
    { $set: parsed.data },
    { new: true },
  )
    .select('url events active createdAt')
    .lean();
  if (!doc) {
    return NextResponse.json({ error: 'Webhook introuvable.' }, { status: 404 });
  }

  return NextResponse.json({
    id: String(doc._id),
    url: doc.url,
    events: doc.events,
    active: doc.active,
    createdAt: doc.createdAt,
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: 'Webhook introuvable.' }, { status: 404 });
  }

  await connectDb();
  const res = await Webhook.deleteOne({ _id: id, userId: user.id });
  if (res.deletedCount === 0) {
    return NextResponse.json({ error: 'Webhook introuvable.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
