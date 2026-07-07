import type { Metadata } from 'next';
import { connectDb, PlatformCredential } from '@sallycourse/db';
import { requireUser } from '@/lib/session';
import { PlatformsManager, type ConnectedCredential } from './platforms-manager';

/**
 * Réglages → Plateformes : gestion des connexions de déploiement (Udemy,
 * YouTube, Teachable…). Les credentials sont stockés chiffrés ; cette page ne
 * lit QUE les métadonnées publiques (jamais le secret).
 */

export const metadata: Metadata = {
  title: 'Plateformes — SallyCourse',
  description: 'Connectez vos comptes de publication pour déployer vos cours.',
};

// Données par utilisateur : rendu à la requête.
export const dynamic = 'force-dynamic';

export default async function PlatformsSettingsPage() {
  const user = await requireUser();

  await connectDb();

  const creds = await PlatformCredential.find({ userId: user.id })
    .select('platform accountLabel kind')
    .sort({ updatedAt: -1 })
    .lean();

  const initialCredentials: ConnectedCredential[] = creds.map((c) => ({
    id: String(c._id),
    platform: c.platform,
    accountLabel: c.accountLabel,
    kind: c.kind,
  }));

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold text-foreground">Plateformes</h1>
        <p className="max-w-2xl text-muted">
          Connectez vos comptes de publication pour déployer automatiquement vos cours. Vos
          identifiants sont chiffrés côté serveur et ne quittent jamais la base en clair.
        </p>
      </header>

      <PlatformsManager initialCredentials={initialCredentials} />
    </div>
  );
}
