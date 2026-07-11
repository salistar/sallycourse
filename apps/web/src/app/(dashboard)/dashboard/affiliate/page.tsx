import type { Metadata } from 'next';
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

export const metadata: Metadata = {
  title: 'Affiliation — SallyCourse',
  description: 'Partagez votre lien et gagnez une commission sur chaque abonnement converti.',
};

export const dynamic = 'force-dynamic';

export default async function AffiliatePage() {
  const user = await requireUser();
  const stats = await getAffiliateStats(user.id);
  const shareUrl = affiliateShareUrl(getConfig().APP_URL, stats.code);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold text-foreground">Affiliation</h1>
        <p className="max-w-2xl text-muted">
          Partagez votre lien personnel : chaque nouvel abonnement payant souscrit dans les 30 jours
          suivant un clic vous rapporte une commission.
        </p>
      </header>

      <AffiliateManager shareUrl={shareUrl} stats={stats} />
    </div>
  );
}
