import { NextResponse } from 'next/server';
import { PlatformCredential, connectDb } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { buildCatalog, MAX_CONCURRENT_DEPLOYMENTS } from '@/lib/deploy-catalog';

/**
 * GET /api/platforms/catalog — catalogue des plateformes de déploiement :
 * capacités (modes, besoin navigateur), et pour l'utilisateur connecté, le
 * statut de connexion (credential présent). Pilote l'écran « Déployer ».
 */

// Statut de connexion par utilisateur : jamais de cache.
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  await connectDb();

  // Plateformes déjà connectées (un credential par (userId, platform)).
  const connected = await PlatformCredential.find({ userId: user.id })
    .select('platform accountLabel')
    .lean();
  const byPlatform = new Map(connected.map((c) => [c.platform, c.accountLabel]));

  const platforms = buildCatalog().map((entry) => ({
    ...entry,
    connected: byPlatform.has(entry.id),
    accountLabel: byPlatform.get(entry.id),
  }));

  return NextResponse.json({
    platforms,
    maxConcurrent: MAX_CONCURRENT_DEPLOYMENTS,
  });
}
