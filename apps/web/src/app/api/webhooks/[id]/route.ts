import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
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
    return apiError('webhookNotFound');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('invalidJson');
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Données invalides.', code: 'invalidData', details: parsed.error.flatten().fieldErrors },
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
    return apiError('webhookNotFound');
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
    return apiError('webhookNotFound');
  }

  await connectDb();
  const res = await Webhook.deleteOne({ _id: id, userId: user.id });
  if (res.deletedCount === 0) {
    return apiError('webhookNotFound');
  }

  return NextResponse.json({ ok: true });
}
