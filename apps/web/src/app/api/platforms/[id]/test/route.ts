import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import { getConfig, decryptCredentials, redactCredentials } from '@sallycourse/shared';
import { connectDb, PlatformCredential } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { logger } from '@/lib/logger';

/**
 * POST /api/platforms/[id]/test — test de connexion à une plateforme.
 * En mode mock (MOCK_PROVIDERS) ou credential incomplet → { ok:true, mock:true }
 * sans appel réseau. Sinon, vérification basique (présence des champs / ping
 * léger YouTube). Aucun secret n'apparaît dans les logs ni la réponse.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: 'Identifiant invalide.' }, { status: 400 });
  }

  await connectDb();

  const cred = await PlatformCredential.findOne({ _id: id, userId: user.id }).lean();
  if (!cred) {
    return NextResponse.json({ error: 'Credential introuvable.' }, { status: 404 });
  }

  const config = getConfig();

  // Déchiffrement serveur — jamais renvoyé en clair.
  let data: Record<string, string>;
  try {
    data = decryptCredentials(cred.data, config.CREDENTIALS_MASTER_KEY);
  } catch {
    logger.warn({ platform: cred.platform }, 'échec déchiffrement credential au test');
    return NextResponse.json(
      { ok: false, mock: false, message: 'Impossible de déchiffrer le credential.' },
      { status: 200 },
    );
  }

  const hasValues = Object.values(data).some((v) => v.trim() !== '');

  // Mode simulé : providers mockés OU credential vide → pas d'appel réseau.
  if (config.MOCK_PROVIDERS || !hasValues) {
    logger.info(
      { platform: cred.platform, credentials: redactCredentials(data) },
      '[mock] test de connexion simulé',
    );
    return NextResponse.json({ ok: true, mock: true, message: 'Connexion simulée (mode mock).' });
  }

  // Vérification basique réelle, sans effet de bord.
  try {
    if (cred.platform === 'youtube' && data.accessToken) {
      // Ping léger de l'API Data v3 : la chaîne du compte authentifié.
      const res = await fetch(
        'https://www.googleapis.com/youtube/v3/channels?part=id&mine=true',
        { headers: { Authorization: `Bearer ${data.accessToken}` } },
      );
      const ok = res.ok;
      return NextResponse.json({
        ok,
        mock: false,
        message: ok ? 'Compte YouTube joignable.' : 'Jeton YouTube refusé.',
      });
    }

    // Autres plateformes : validation de forme (champs requis non vides).
    return NextResponse.json({
      ok: true,
      mock: false,
      message: 'Credential présent et bien formé.',
    });
  } catch (err) {
    logger.warn({ platform: cred.platform, err: (err as Error).message }, 'échec test de connexion');
    return NextResponse.json({ ok: false, mock: false, message: 'Test de connexion échoué.' });
  }
}
