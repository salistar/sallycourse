import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { PLAN_PRICING, formatAmount } from '@/lib/payments/plans';
import { BillingManager } from './billing-manager';
import { ChangePlanSection } from './change-plan-section';

/**
 * Réglages → Facturation (Prompt 148, conformité fiscale Maroc) : statut
 * fiscal, ICE, IF, historique de facturation et export comptable CSV.
 *
 * Synergie SallyFiscal (autre projet SALISTAR, simulateur fiscal Maroc+France) :
 * ces réglages (ICE, statut auto-entrepreneur/société) et l'historique de
 * facturation pourraient à terme nourrir une simulation fiscale personnalisée
 * dans SallyFiscal — aucune intégration technique aujourd'hui, simple synergie
 * de roadmap entre les deux produits SALISTAR.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.billingPage');
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  };
}

export const dynamic = 'force-dynamic';

export default async function BillingSettingsPage() {
  const user = await requireUser();
  const t = await getTranslations('settings.billingPage');

  // Prix affichés (P?, audit design) : formatés côté serveur — plans.ts tire
  // node:crypto via affiliate.ts et ne peut pas être importé dans un composant client.
  const planPrices = {
    pro: { mad: formatAmount(PLAN_PRICING.pro.MAD), eur: formatAmount(PLAN_PRICING.pro.EUR) },
    business: { mad: formatAmount(PLAN_PRICING.business.MAD), eur: formatAmount(PLAN_PRICING.business.EUR) },
  };

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold text-foreground">{t('heading')}</h1>
        <p className="max-w-2xl text-muted">{t('description')}</p>
      </header>

      <ChangePlanSection currentPlan={user.plan ?? 'free'} prices={planPrices} />

      <BillingManager />
    </div>
  );
}
