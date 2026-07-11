import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import { connectDb, DeployPreset } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';

/**
 * /api/deploy-presets/[id] — suppression d'un preset de déploiement (P109).
 * Seul le propriétaire peut supprimer (jamais un preset public d'autrui).
 */

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: 'Preset introuvable.' }, { status: 404 });
  }

  await connectDb();

  const deleted = await DeployPreset.findOneAndDelete({ _id: id, userId: user.id });
  if (!deleted) {
    return NextResponse.json({ error: 'Preset introuvable.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
