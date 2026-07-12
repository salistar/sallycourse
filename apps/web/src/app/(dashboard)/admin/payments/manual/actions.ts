'use server';

import { revalidatePath } from 'next/cache';
import { Types } from 'mongoose';
import { connectDb, ManualPaymentRequest } from '@sallycourse/db';
import { auth } from '@/lib/auth';
import { activatePlan, isPaidPlan } from '@/lib/payments/plans';
import { transitionManualPayment } from '@/lib/payments/manual-payment';
import { logger } from '@/lib/logger';

/**
 * Actions serveur admin pour les demandes de paiement manuel (Prompt 158) :
 * approuver (active le plan, exactement comme le fait le webhook CMI/Paddle)
 * ou rejeter (motif libre). Réservées aux admins. Idempotent côté
 * transition : une demande déjà traitée ne peut pas être re-décidée.
 */

async function requireAdminId(): Promise<string> {
  const session = await auth();
  if (session?.user?.role !== 'admin') {
    throw new Error('Accès réservé aux administrateurs.');
  }
  return session.user.id;
}

/** Approuve une demande : transition + activation du plan (idempotente). */
export async function approveManualPaymentAction(formData: FormData): Promise<void> {
  const adminId = await requireAdminId();
  const requestId = String(formData.get('requestId') ?? '');
  if (!Types.ObjectId.isValid(requestId)) throw new Error('Identifiant de demande invalide.');

  await connectDb();
  const doc = await ManualPaymentRequest.findById(requestId);
  if (!doc) throw new Error('Demande introuvable.');

  const transition = transitionManualPayment({ currentStatus: doc.status, decision: 'approve' });
  if (!transition.ok) throw new Error(transition.reason);

  if (!isPaidPlan(doc.plan)) throw new Error(`Plan non payant sur la demande : ${doc.plan}.`);

  const result = await activatePlan({
    userId: doc.userId.toString(),
    plan: doc.plan,
    provider: 'mock', // virement manuel : pas de prestataire de paiement en ligne
    providerRef: `manual-${doc._id.toString()}`,
  });
  if (!result.ok) throw new Error(`Activation du plan échouée : ${result.reason}`);

  doc.status = transition.nextStatus;
  doc.reviewedBy = new Types.ObjectId(adminId);
  doc.reviewedAt = new Date();
  await doc.save();

  logger.info(
    { adminId, requestId, userId: doc.userId.toString(), plan: doc.plan },
    'Paiement manuel : demande approuvée, plan activé',
  );
  revalidatePath('/admin/payments/manual');
}

/** Rejette une demande avec un motif libre. */
export async function rejectManualPaymentAction(formData: FormData): Promise<void> {
  const adminId = await requireAdminId();
  const requestId = String(formData.get('requestId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim().slice(0, 500);
  if (!Types.ObjectId.isValid(requestId)) throw new Error('Identifiant de demande invalide.');

  await connectDb();
  const doc = await ManualPaymentRequest.findById(requestId);
  if (!doc) throw new Error('Demande introuvable.');

  const transition = transitionManualPayment({ currentStatus: doc.status, decision: 'reject' });
  if (!transition.ok) throw new Error(transition.reason);

  doc.status = transition.nextStatus;
  doc.reviewedBy = new Types.ObjectId(adminId);
  doc.reviewedAt = new Date();
  doc.rejectionReason = reason || undefined;
  await doc.save();

  logger.info({ adminId, requestId, userId: doc.userId.toString() }, 'Paiement manuel : demande rejetée');
  revalidatePath('/admin/payments/manual');
}
