import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import { connectDb, PlatformCredential } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';

/**
 * DELETE /api/platforms/[id] — déconnecte une plateforme (supprime le
 * credential chiffré). 404 (et non 403) si le credential n'appartient pas à
 * l'utilisateur, pour ne pas divulguer son existence.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: 'Identifiant invalide.' }, { status: 400 });
  }

  await connectDb();

  const result = await PlatformCredential.deleteOne({ _id: id, userId: user.id });
  if (result.deletedCount === 0) {
    return NextResponse.json({ error: 'Credential introuvable.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
