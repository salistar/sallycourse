import { PLANS, type PlanId } from '@sallycourse/shared';
import {
  connectDb,
  User as UserModel,
  Subscription as SubscriptionModel,
  type PaymentProvider,
} from '@sallycourse/db';

/**
 * Tarification & activation de plan (P54). Source unique des prix affichés et
 * facturés, et point d'entrée unique pour ACTIVER un plan après un paiement
 * confirmé (callback CMI, webhook Paddle/Lemon Squeezy, mock dev). Logique
 * d'activation idempotente : rejouer un webhook n'accorde pas deux mois.
 */

/** Un plan payant (le plan free n'a pas de checkout). */
export type PaidPlanId = Exclude<PlanId, 'free'>;

/** Devises supportées : MAD via CMI (Maroc), EUR via Paddle/Lemon (international). */
export type Currency = 'MAD' | 'EUR';

export interface PlanPrice {
  /** Montant en plus petite unité (centimes EUR, centimes MAD). */
  amountMinor: number;
  currency: Currency;
}

/**
 * Grille tarifaire mensuelle. Les montants EUR reflètent la page /pricing
 * (29 € / 99 €) ; les montants MAD sont les prix marché marocains équivalents.
 * Tout est en plus petite unité pour éviter les flottants.
 */
export const PLAN_PRICING: Record<PaidPlanId, Record<Currency, PlanPrice>> = {
  pro: {
    EUR: { amountMinor: 2900, currency: 'EUR' },
    MAD: { amountMinor: 29900, currency: 'MAD' },
  },
  business: {
    EUR: { amountMinor: 9900, currency: 'EUR' },
    MAD: { amountMinor: 99900, currency: 'MAD' },
  },
};

/** Vrai si l'identifiant est un plan payant connu (pro|business). */
export function isPaidPlan(plan: string): plan is PaidPlanId {
  return plan in PLAN_PRICING;
}

/** Prix d'un plan dans une devise, ou null si plan/devise inconnus. */
export function priceFor(plan: string, currency: Currency): PlanPrice | null {
  if (!isPaidPlan(plan)) return null;
  return PLAN_PRICING[plan][currency] ?? null;
}

/** Montant formaté pour affichage/facture (ex. « 299,00 MAD », « 29,00 EUR »). */
export function formatAmount(price: PlanPrice, locale = 'fr-FR'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: price.currency,
  }).format(price.amountMinor / 100);
}

/** Un mois calendaire après `from` — fin de période par défaut à l'activation. */
export function addOneMonth(from: Date = new Date()): Date {
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

export interface ActivatePlanInput {
  userId: string;
  plan: PaidPlanId;
  provider: PaymentProvider;
  /** Référence prestataire (oid CMI, subscription_id…) — clé d'idempotence. */
  providerRef?: string;
  /** Fin de période ; défaut = +1 mois. */
  currentPeriodEnd?: Date;
}

export interface ActivatePlanResult {
  ok: boolean;
  reason: string;
  /** true si l'appel a effectivement (re)posé l'abonnement — false si rejeu. */
  applied: boolean;
}

/**
 * Active un plan payant après paiement confirmé : upsert de l'abonnement
 * (idempotent par (provider, providerRef) si fourni) puis mise à jour de
 * User.plan. Rejouer le même providerRef ne recrée pas d'abonnement mais
 * garantit l'état cible (plan + statut active).
 */
export async function activatePlan(input: ActivatePlanInput): Promise<ActivatePlanResult> {
  const { userId, plan, provider, providerRef } = input;
  if (!isPaidPlan(plan)) {
    return { ok: false, reason: `Plan inconnu : ${plan}.`, applied: false };
  }

  await connectDb();

  const user = await UserModel.findById(userId).select('_id').lean();
  if (!user) return { ok: false, reason: 'Utilisateur introuvable.', applied: false };

  const currentPeriodEnd = input.currentPeriodEnd ?? addOneMonth();

  // Idempotence : si un providerRef est fourni, on upsert sur (provider, ref).
  // Sans providerRef (mock), on upsert sur (userId, provider) le dernier actif.
  const filter = providerRef ? { provider, providerRef } : { userId, provider };

  await SubscriptionModel.updateOne(
    filter,
    {
      $set: {
        userId,
        plan,
        provider,
        status: 'active' as const,
        currentPeriodEnd,
        ...(providerRef ? { providerRef } : {}),
      },
    },
    { upsert: true },
  );

  // Le plan de l'utilisateur reflète l'abonnement actif.
  await UserModel.updateOne({ _id: userId }, { $set: { plan } });

  return { ok: true, reason: 'Plan activé.', applied: true };
}

/**
 * Marque un abonnement comme non-actif (annulation/expiration/impayé) et
 * rétrograde l'utilisateur en free. Best-effort, idempotent.
 */
export async function deactivateSubscription(
  provider: PaymentProvider,
  providerRef: string,
  status: 'canceled' | 'expired' | 'past_due' = 'canceled',
): Promise<void> {
  await connectDb();
  const sub = await SubscriptionModel.findOneAndUpdate(
    { provider, providerRef },
    { $set: { status } },
    { new: true },
  ).lean();

  // past_due ne rétrograde pas immédiatement : on laisse la période courir.
  if (sub && status !== 'past_due') {
    await UserModel.updateOne({ _id: sub.userId }, { $set: { plan: 'free' } });
  }
}

/** Métadonnée d'affichage d'un plan (nom lisible) pour factures/emails. */
export const PLAN_LABELS: Record<PlanId, string> = {
  free: 'Free',
  pro: 'Pro',
  business: 'Business',
};

// Ré-export pour l'ergonomie des appelants (évite un second import shared).
export { PLANS };
