import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { Types } from 'mongoose';
import { presignedGetUrl } from '@sallycourse/shared';
import { connectDb, ManualPaymentRequest } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';

/**
 * GET /api/admin/payments/manual/[id]/proof — redirige vers une URL présignée
 * (1h) de la preuve de virement d'une demande de paiement manuel (Prompt 158).
 * Réservé aux admins — la preuve peut contenir des données bancaires du
 * client, jamais servie directement en public.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;
  if (user.role !== 'admin') {
    return apiError('adminOnly');
  }

  const { id } = await params;
  if (!Types.ObjectId.isValid(id)) {
    return apiError('invalidId');
  }

  await connectDb();
  const doc = await ManualPaymentRequest.findById(id).select('proofUrl').lean();
  if (!doc || !doc.proofUrl) {
    return NextResponse.json({ error: 'Preuve introuvable.', code: 'proofNotFound' }, { status: 404 });
  }

  const url = await presignedGetUrl(doc.proofUrl, 3600);
  return NextResponse.redirect(url);
}
