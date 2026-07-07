import { PLANS, type PlanId } from '@sallycourse/shared';
import { connectDb, User as UserModel, type IUser } from '@sallycourse/db';

/**
 * Quotas & plans — helper central (P53). Source unique de la logique de
 * réservation/libération des crédits de cours mensuels et de l'état de quota
 * exposé à l'UI. Le POST /api/courses (via create-course.ts) et l'API publique
 * v1 doivent importer ce module plutôt que de dupliquer la logique inline.
 *
 * Règles :
 *  - fenêtre = mois calendaire UTC ; reset si periodStart tombe sur un autre mois ;
 *  - réservation ATOMIQUE (résiste à la double soumission) ;
 *  - business = Infinity → aucune limite, aucune écriture de compteur.
 */

/** Vrai si les deux dates tombent dans le même mois calendaire (UTC). */
function isSameUtcMonth(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
}

/** Premier instant du mois calendaire UTC contenant `d`. */
function startOfUtcMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}

/** Premier instant du mois calendaire UTC SUIVANT `d` (= date de reset). */
function startOfNextUtcMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

export type ReserveResult =
  | { ok: true }
  | { ok: false; reason: 'quota_exceeded'; plan: PlanId; limit: number }
  | { ok: false; reason: 'user_not_found' };

/**
 * Réserve atomiquement un crédit de cours du mois courant pour l'utilisateur.
 * Reset transparent si le compteur date d'un autre mois UTC. Plan à limite
 * infinie (business) : succès immédiat sans écriture.
 *
 * En cas de succès, appelez releaseQuota(userId) si la suite de l'opération
 * échoue, pour rendre le crédit.
 */
export async function checkAndReserveCourseQuota(userId: string): Promise<ReserveResult> {
  await connectDb();

  const userDoc = await UserModel.findById(userId).select('plan quotaUsed').lean();
  if (!userDoc) return { ok: false, reason: 'user_not_found' };

  const plan = (userDoc.plan ?? 'free') as PlanId;
  const limit = PLANS[plan].coursesPerMonth;

  // Plan illimité : rien à réserver ni à compter.
  if (!Number.isFinite(limit)) return { ok: true };

  const now = new Date();
  const periodStart = userDoc.quotaUsed?.periodStart
    ? new Date(userDoc.quotaUsed.periodStart)
    : new Date(0);
  const samePeriod = isSameUtcMonth(periodStart, now);
  const used = samePeriod ? (userDoc.quotaUsed?.coursesThisMonth ?? 0) : 0;

  if (used >= limit) return { ok: false, reason: 'quota_exceeded', plan, limit };

  // Réservation atomique : le filtre garantit qu'on ne dépasse jamais la limite
  // même sous double soumission concurrente.
  const reserved = samePeriod
    ? await UserModel.updateOne(
        { _id: userId, 'quotaUsed.coursesThisMonth': { $lt: limit } },
        { $inc: { 'quotaUsed.coursesThisMonth': 1 } },
      )
    : await UserModel.updateOne(
        { _id: userId },
        { $set: { quotaUsed: { coursesThisMonth: 1, periodStart: startOfUtcMonth(now) } } },
      );

  if (reserved.modifiedCount === 0) {
    return { ok: false, reason: 'quota_exceeded', plan, limit };
  }
  return { ok: true };
}

/**
 * Rend un crédit précédemment réservé (rollback quand la création échoue après
 * réservation). Best-effort : ne descend jamais sous zéro. Sans effet pour les
 * plans illimités (aucun crédit n'y est compté).
 */
export async function releaseQuota(userId: string): Promise<void> {
  await connectDb();
  await UserModel.updateOne(
    { _id: userId, 'quotaUsed.coursesThisMonth': { $gt: 0 } },
    { $inc: { 'quotaUsed.coursesThisMonth': -1 } },
  ).catch(() => undefined);
}

export interface QuotaState {
  /** Crédits consommés sur la fenêtre courante (0 si le compteur a expiré). */
  used: number;
  /** Limite du plan (Infinity pour business). */
  limit: number;
  /** Crédits restants (Infinity pour business). */
  remaining: number;
  /** Date de remise à zéro (début du mois UTC suivant) ; null si illimité. */
  resetsAt: Date | null;
}

/** Sous-ensemble d'IUser suffisant pour calculer l'état de quota. */
type QuotaUserLike = Pick<IUser, 'plan'> & {
  quotaUsed?: { coursesThisMonth?: number; periodStart?: Date } | null;
};

/**
 * État de quota pour l'affichage (dashboard, page settings). Fonction PURE :
 * n'écrit rien et gère le reset « virtuel » quand le compteur date d'un autre
 * mois (used=0 tant que la prochaine réservation n'a pas réécrit le compteur).
 */
export function getQuotaState(user: QuotaUserLike, now: Date = new Date()): QuotaState {
  const plan = (user.plan ?? 'free') as PlanId;
  const limit = PLANS[plan].coursesPerMonth;

  if (!Number.isFinite(limit)) {
    return { used: 0, limit: Infinity, remaining: Infinity, resetsAt: null };
  }

  const periodStart = user.quotaUsed?.periodStart
    ? new Date(user.quotaUsed.periodStart)
    : new Date(0);
  const samePeriod = isSameUtcMonth(periodStart, now);
  const used = samePeriod ? (user.quotaUsed?.coursesThisMonth ?? 0) : 0;

  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resetsAt: startOfNextUtcMonth(now),
  };
}

// ── Quota de déploiement ─────────────────────────────────────────
/**
 * Nombre max de plateformes déployables en un lot selon le plan (P53). Free est
 * bridé (1 à la fois) ; pro/business déploient partout.
 */
export function maxDeployPlatformsForPlan(plan: PlanId): number {
  return PLANS[plan].maxDeployPlatforms;
}

export type DeployGateResult =
  | { ok: true }
  | { ok: false; plan: PlanId; limit: number; requested: number };

/**
 * Vérifie qu'un plan autorise le déploiement vers `requestedCount` plateformes.
 * Fonction pure — l'appelant mappe l'échec vers un status HTTP (403).
 */
export function checkDeployPlatformLimit(plan: PlanId, requestedCount: number): DeployGateResult {
  const limit = maxDeployPlatformsForPlan(plan);
  if (requestedCount > limit) {
    return { ok: false, plan, limit, requested: requestedCount };
  }
  return { ok: true };
}
