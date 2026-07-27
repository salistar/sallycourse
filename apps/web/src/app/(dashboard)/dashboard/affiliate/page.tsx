import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { getConfig } from '@sallycourse/shared';
import { requireUser } from '@/lib/session';
import { getAffiliateStats } from '@/lib/payments/affiliate-service';
import { affiliateShareUrl } from '@/lib/affiliate';
import { AffiliateManager } from './affiliate-manager';

/**
 * Dashboard → Affiliation (Prompt 89) : lien à partager, statistiques
 * clics/conversions/gains. Le lien est créé paresseusement au premier accès
 * (getOrCreateAffiliateLink, appelé par getAffiliateStats).
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('affiliate.page');
  return {
    title: t('metadata.title'),
    description: t('metadata.description'),
  };
}

export const dynamic = 'force-dynamic';

export default async function AffiliatePage() {
  const user = await requireUser();
  const stats = await getAffiliateStats(user.id);
  const shareUrl = affiliateShareUrl(getConfig().APP_URL, stats.code);
  const t = await getTranslations('affiliate.page');

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold text-foreground">{t('heading')}</h1>
        <p className="max-w-2xl text-muted">{t('description')}</p>
      </header>

      <AffiliateManager shareUrl={shareUrl} stats={stats} />
    </div>
  );
}
