import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import { connectDb, ApiKey } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';

/**
 * DELETE /api/api-keys/[id] — révoque une clé API de l'utilisateur. La
 * révocation est immédiate : le hash disparaît, toute requête ultérieure
 * présentant cette clé échoue en 401.
 */

export const dynamic = 'force-dynamic';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return apiError('keyNotFound');
  }

  await connectDb();
  const res = await ApiKey.deleteOne({ _id: id, userId: user.id });
  if (res.deletedCount === 0) {
    return apiError('keyNotFound');
  }

  return NextResponse.json({ ok: true });
}
