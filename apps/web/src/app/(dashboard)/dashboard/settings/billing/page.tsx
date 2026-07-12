import type { Metadata } from 'next';
import { requireUser } from '@/lib/session';
import { BillingManager } from './billing-manager';

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

export const metadata: Metadata = {
  title: 'Facturation — SallyCourse',
  description: 'Renseignez vos informations fiscales marocaines et consultez vos factures.',
};

export const dynamic = 'force-dynamic';

export default async function BillingSettingsPage() {
  await requireUser();

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold text-foreground">Facturation</h1>
        <p className="max-w-2xl text-muted">
          Renseignez votre statut fiscal (auto-entrepreneur ou société) pour recevoir des factures
          conformes, avec votre ICE et IF le cas échéant. Consultez et exportez votre historique de
          facturation.
        </p>
      </header>

      <BillingManager />
    </div>
  );
}
