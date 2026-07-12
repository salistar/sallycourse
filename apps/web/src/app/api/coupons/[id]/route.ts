import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import { connectDb, Coupon } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';

/**
 * /api/coupons/[id] — suppression d'un coupon (Prompt 139).
 * Seul le propriétaire peut supprimer. Ne bloque pas si déjà utilisé (les
 * enrollments passés référencent le coupon par snapshot de prix, pas par id).
 */

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: 'Coupon introuvable.' }, { status: 404 });
  }

  await connectDb();

  const deleted = await Coupon.findOneAndDelete({ _id: id, userId: user.id });
  if (!deleted) {
    return NextResponse.json({ error: 'Coupon introuvable.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
