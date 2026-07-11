import { CourseAnalytics, Subscription, connectDb } from '@sallycourse/db';
import { PLAN_PRICING, type Currency, type PaidPlanId } from '@/lib/payments/plans';
import {
  courseAnalyticsToEntries,
  gumroadToEntries,
  subscriptionsToEntries,
  type RevenueEntry,
} from '@/lib/revenue-aggregate';

/**
 * Accès Mongo pour le dashboard revenus consolidé (P99). Isolé de
 * revenue-aggregate.ts (logique pure testable) : ce module fait les requêtes
 * puis délègue la conversion/agrégation aux fonctions pures.
 */

/** Devise de facturation attribuée par provider (CMI → MAD, Paddle/Lemon → EUR). */
function currencyForProvider(provider: string): Currency {
  return provider === 'cmi' ? 'MAD' : 'EUR';
}

/**
 * Charge toutes les entrées de revenu consolidées (Udemy/YouTube +
 * abonnements + Gumroad) sur toute la base. Utilisé par la page admin et
 * l'export CSV comptable — un seul point de vérité pour ne pas diverger.
 */
export async function loadAllRevenueEntries(): Promise<RevenueEntry[]> {
  await connectDb();

  const [analyticsRows, subscriptions] = await Promise.all([
    CourseAnalytics.find({}).select('courseId platform revenue fetchedAt').lean(),
    // Seuls les abonnements ACTIFS génèrent un revenu récurrent affiché ici ;
    // les abonnements annulés/expirés ont déjà été facturés dans le passé et
    // ne sont pas ré-imputés (pas d'historique de facturation détaillé pour
    // l'instant — voir limitation dans le README de la page).
    Subscription.find({ status: 'active' }).select('userId provider plan currentPeriodEnd updatedAt').lean(),
  ]);

  const analyticsEntries = courseAnalyticsToEntries(
    analyticsRows.map((r) => ({
      courseId: String(r.courseId),
      platform: r.platform,
      revenue: r.revenue,
      fetchedAt: r.fetchedAt,
    })),
  );

  const subscriptionEntries = subscriptionsToEntries(
    subscriptions
      .filter((s) => s.plan in PLAN_PRICING)
      .map((s) => {
        const currency = currencyForProvider(s.provider);
        const price = PLAN_PRICING[s.plan as PaidPlanId][currency];
        return {
          userId: String(s.userId),
          currency,
          amount: price.amountMinor / 100,
          // Imputé au mois de dernière mise à jour de l'abonnement (activation
          // ou renouvellement) — approximation raisonnable sans historique
          // de facturation ligne à ligne.
          billedAt: (s.updatedAt as Date) ?? new Date(),
        };
      }),
  );

  const gumroadEntries = gumroadToEntries();

  return [...analyticsEntries, ...subscriptionEntries, ...gumroadEntries];
}
