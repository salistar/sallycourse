import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import { connectDb, Webhook } from '@sallycourse/db';
import { requireApiKeyUser } from '@/lib/api-auth';

/**
 * DELETE /api/v1/zapier/hooks/[id] — unsubscribe REST Hook Zapier (Prompt 97).
 * Zapier appelle ce endpoint quand un utilisateur désactive un Zap : supprime
 * le Webhook interne créé lors du subscribe. Idempotent côté Zapier (un 404 sur
 * un id déjà supprimé n'est pas traité comme une erreur bloquante par Zapier).
 */

export const dynamic = 'force-dynamic';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiKeyUser(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: 'Abonnement introuvable.', code: 'subscriptionNotFound' }, { status: 404 });
  }

  await connectDb();
  const res = await Webhook.deleteOne({ _id: id, userId: auth.userId });
  if (res.deletedCount === 0) {
    return NextResponse.json({ error: 'Abonnement introuvable.', code: 'subscriptionNotFound' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
