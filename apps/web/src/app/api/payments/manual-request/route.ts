import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { storageKeys, uploadObject } from '@sallycourse/shared';
import { connectDb, ManualPaymentRequest } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { validateManualPaymentRequest } from '@/lib/payments/manual-payment';
import { logger } from '@/lib/logger';

/**
 * POST /api/payments/manual-request — soumission d'une demande de paiement
 * manuel (virement bancaire international, zéro commission, Prompt 158).
 * Multipart : plan, amountRequested (plus petite unité), currency, note?,
 * proof? (fichier, optionnel). L'admin traite ensuite la demande depuis
 * /admin/payments/manual (approuver active le plan, rejeter clôture).
 *
 * Aucune activation ici : une demande manuelle reste `pending` jusqu'à revue
 * humaine — pas de webhook prestataire pour un virement bancaire.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PROOF_MB = 10;
const ACCEPTED_PROOF_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];

export async function POST(request: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError('invalidMultipart');
  }

  const plan = String(form.get('plan') ?? '');
  const amountRaw = form.get('amountRequested');
  const amountRequested = typeof amountRaw === 'string' ? Number.parseInt(amountRaw, 10) : NaN;
  const currency = String(form.get('currency') ?? '');
  const noteRaw = form.get('note');
  const note = typeof noteRaw === 'string' && noteRaw.trim() ? noteRaw.trim().slice(0, 500) : undefined;

  const validation = validateManualPaymentRequest({ plan, amountRequested, currency });
  if (!validation.ok || !validation.plan || !validation.currency) {
    return NextResponse.json({ error: validation.reason }, { status: 400 });
  }

  const proof = form.get('proof');
  if (proof instanceof File && proof.size > 0) {
    if (proof.type && !ACCEPTED_PROOF_TYPES.includes(proof.type)) {
      return NextResponse.json(
        { error: 'Format de preuve non supporté (PNG, JPEG, WebP ou PDF attendu).', code: 'unsupportedProofFormat' },
        { status: 415 },
      );
    }
    if (proof.size > MAX_PROOF_MB * 1024 * 1024) {
      return NextResponse.json({ error: `Preuve trop lourde (max ${MAX_PROOF_MB} Mo).`, code: 'manualPaymentProofTooLarge', params: { max: MAX_PROOF_MB } }, { status: 413 });
    }
  }

  await connectDb();

  // Créée d'abord sans preuve : la clé de stockage (storageKeys.manualPaymentProof)
  // dépend de l'id du document, connu seulement après insertion.
  const doc = await ManualPaymentRequest.create({
    userId: user.id,
    plan: validation.plan,
    amountRequested,
    currency: validation.currency,
    status: 'pending',
    note,
  });

  if (proof instanceof File && proof.size > 0) {
    const ext = proof.type === 'application/pdf' ? 'pdf' : (proof.type.split('/')[1] || 'bin');
    const key = storageKeys.manualPaymentProof(user.id, doc._id.toString(), ext);
    try {
      const buffer = Buffer.from(await proof.arrayBuffer());
      await uploadObject(key, buffer, proof.type || 'application/octet-stream');
      doc.proofUrl = key;
      await doc.save();
    } catch (err) {
      logger.warn({ err, userId: user.id, id: doc._id.toString() }, 'Paiement manuel : échec upload preuve (best-effort)');
    }
  }

  logger.info(
    { userId: user.id, plan: validation.plan, amountRequested, currency: validation.currency, id: doc._id.toString() },
    'Paiement manuel : demande soumise',
  );

  return NextResponse.json(
    { ok: true, id: doc._id.toString(), status: doc.status, proofUploaded: Boolean(doc.proofUrl) },
    { status: 201 },
  );
}

/** GET — historique des demandes de l'utilisateur connecté. */
export async function GET() {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  await connectDb();
  const requests = await ManualPaymentRequest.find({ userId: user.id })
    .sort({ createdAt: -1 })
    .select('plan amountRequested currency status createdAt reviewedAt rejectionReason')
    .lean();

  return NextResponse.json({
    requests: requests.map((r) => ({
      id: r._id.toString(),
      plan: r.plan,
      amountRequested: r.amountRequested,
      currency: r.currency,
      status: r.status,
      createdAt: r.createdAt,
      reviewedAt: r.reviewedAt ?? null,
      rejectionReason: r.rejectionReason ?? null,
    })),
  });
}
