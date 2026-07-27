import type { Metadata } from 'next';
import { connectDb, DeployPreset } from '@sallycourse/db';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { DeployPresetsManager, type PresetSummary } from './deploy-presets-manager';

/**
 * Réglages → Mes presets de déploiement (P109) : marketplace de
 * préconfiguration — combinaisons plateforme+mode+compte réutilisables en un
 * clic sur n'importe quel cours prêt.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.deployPresetsPage');
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  };
}

// Données par utilisateur : rendu à la requête.
export const dynamic = 'force-dynamic';

export default async function DeployPresetsSettingsPage() {
  const user = await requireUser();
  const t = await getTranslations('settings.deployPresetsPage');

  await connectDb();

  const [mine, publicOnes] = await Promise.all([
    DeployPreset.find({ userId: user.id }).sort({ updatedAt: -1 }).lean(),
    DeployPreset.find({ isPublic: true, userId: { $ne: user.id } })
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean(),
  ]);

  const toSummary = (doc: (typeof mine)[number]): PresetSummary => ({
    id: String(doc._id),
    name: doc.name,
    platforms: doc.platforms.map((p) => ({
      platform: p.platform,
      mode: p.mode,
      accountLabel: p.accountLabel,
    })),
    isPublic: doc.isPublic,
    mine: true,
  });

  const initialPresets: PresetSummary[] = mine.map(toSummary);
  const initialPublicPresets: PresetSummary[] = publicOnes.map((doc) => ({
    ...toSummary(doc),
    mine: false,
  }));

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold text-foreground">
          {t('heading')}
        </h1>
        <p className="max-w-2xl text-muted">{t('intro')}</p>
      </header>

      <DeployPresetsManager
        initialPresets={initialPresets}
        initialPublicPresets={initialPublicPresets}
      />
    </div>
  );
}
