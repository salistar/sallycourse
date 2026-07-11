import type { Metadata } from 'next';
import { connectDb, DeployPreset } from '@sallycourse/db';
import { requireUser } from '@/lib/session';
import { DeployPresetsManager, type PresetSummary } from './deploy-presets-manager';

/**
 * Réglages → Mes presets de déploiement (P109) : marketplace de
 * préconfiguration — combinaisons plateforme+mode+compte réutilisables en un
 * clic sur n'importe quel cours prêt.
 */

export const metadata: Metadata = {
  title: 'Presets de déploiement — SallyCourse',
  description: 'Enregistrez une configuration de déploiement et appliquez-la en un clic.',
};

// Données par utilisateur : rendu à la requête.
export const dynamic = 'force-dynamic';

export default async function DeployPresetsSettingsPage() {
  const user = await requireUser();

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
          Mes presets de déploiement
        </h1>
        <p className="max-w-2xl text-muted">
          Enregistrez une combinaison de plateformes, de modes et de comptes, puis appliquez-la
          en un clic à n&apos;importe quel autre cours prêt. Partagez un preset publiquement pour
          que d&apos;autres utilisateurs en profitent (jamais vos identifiants, seulement la
          configuration).
        </p>
      </header>

      <DeployPresetsManager
        initialPresets={initialPresets}
        initialPublicPresets={initialPublicPresets}
      />
    </div>
  );
}
