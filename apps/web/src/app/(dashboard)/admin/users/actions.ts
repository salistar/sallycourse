'use server';

import { revalidatePath } from 'next/cache';
import { Types } from 'mongoose';
import { connectDb, User } from '@sallycourse/db';
import { PLANS, type PlanId } from '@sallycourse/shared';
import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';

/**
 * Actions serveur de la gestion des utilisateurs (P57) : bannir / réactiver
 * un compte et changer son plan. Réservées aux admins ; un admin ne peut ni
 * se bannir ni se rétrograder lui-même (garde-fou).
 */

const PLAN_IDS = Object.keys(PLANS) as PlanId[];

async function requireAdminId(): Promise<string> {
  const session = await auth();
  if (session?.user?.role !== 'admin') {
    throw new Error('Accès réservé aux administrateurs.');
  }
  return session.user.id;
}

function assertValidTarget(userId: string, adminId: string): void {
  if (!Types.ObjectId.isValid(userId)) throw new Error('Identifiant utilisateur invalide.');
  if (userId === adminId) throw new Error('Action impossible sur votre propre compte.');
}

/** Bannit ou réactive un utilisateur (toggle explicite via `banned`). */
export async function setBannedAction(formData: FormData): Promise<void> {
  const adminId = await requireAdminId();
  const userId = String(formData.get('userId') ?? '');
  const banned = formData.get('banned') === 'true';
  assertValidTarget(userId, adminId);

  await connectDb();
  const res = await User.updateOne({ _id: userId }, { $set: { banned } });
  if (res.matchedCount === 0) throw new Error('Utilisateur introuvable.');

  logger.info({ adminId, userId, banned }, 'admin a modifié le statut de bannissement');
  revalidatePath('/admin/users');
}

/** Change le plan d'un utilisateur. */
export async function setPlanAction(formData: FormData): Promise<void> {
  const adminId = await requireAdminId();
  const userId = String(formData.get('userId') ?? '');
  const plan = String(formData.get('plan') ?? '');
  assertValidTarget(userId, adminId);
  if (!PLAN_IDS.includes(plan as PlanId)) throw new Error('Plan invalide.');

  await connectDb();
  const res = await User.updateOne({ _id: userId }, { $set: { plan } });
  if (res.matchedCount === 0) throw new Error('Utilisateur introuvable.');

  logger.info({ adminId, userId, plan }, 'admin a changé le plan');
  revalidatePath('/admin/users');
}
