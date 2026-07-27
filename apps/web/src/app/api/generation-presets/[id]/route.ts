import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import { connectDb, GenerationPreset } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';

/** DELETE /api/generation-presets/[id] — supprime un preset de génération (propriétaire only). */
export const dynamic = 'force-dynamic';

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return apiError('presetNotFound');
  }

  await connectDb();
  const res = await GenerationPreset.deleteOne({ _id: id, userId: user.id });
  if (res.deletedCount === 0) {
    return apiError('presetNotFound');
  }
  return NextResponse.json({ ok: true });
}
