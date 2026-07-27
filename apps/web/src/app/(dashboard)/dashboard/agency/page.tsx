import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { connectDb, AgencyClient, User } from '@sallycourse/db';
import { requireUser } from '@/lib/session';
import { AgencyManager, type AgencyClientSummary } from './agency-manager';
import { getTranslations } from 'next-intl/server';

/**
 * Dashboard → Agence (Prompt 150) : liste des clients gérés, création de
 * client, switch de contexte « travailler pour ce client » (persisté en
 * localStorage côté client — repris par la création de cours). Réservé aux
 * comptes User.isAgency=true — redirige les autres vers le dashboard normal.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('agency.page');
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  };
}

// Données par utilisateur : rendu à la requête.
export const dynamic = 'force-dynamic';

export default async function AgencyDashboardPage() {
  const t = await getTranslations('agency.page');
  const user = await requireUser();

  await connectDb();

  const me = await User.findById(user.id).select('isAgency').lean();
  if (me?.isAgency !== true) {
    redirect('/dashboard');
  }

  const clients = await AgencyClient.find({ agencyUserId: user.id })
    .sort({ createdAt: -1 })
    .lean();

  const initialClients: AgencyClientSummary[] = clients.map((c) => ({
    id: String(c._id),
    clientName: c.clientName,
    clientEmail: c.clientEmail,
    platformCredentials: c.platformCredentials.map(String),
  }));

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold text-foreground">{t('heading')}</h1>
        <p className="max-w-2xl text-muted">{t('intro')}</p>
      </header>

      <AgencyManager initialClients={initialClients} />
    </div>
  );
}
