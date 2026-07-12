import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getConfig, encryptCredentials } from '@sallycourse/shared';
import { connectDb, PlatformCredential, recordAudit } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { getPlatformMeta, PLATFORM_IDS } from '@/lib/platforms';
import { extractClientIp } from '@/lib/rate-limit';

/**
 * /api/platforms — liste (GET, SANS secrets) et ajout (POST, chiffrement
 * serveur) des credentials plateformes de l'utilisateur. Le secret n'est
 * jamais renvoyé ni journalisé : seul le statut « connecté » est exposé.
 */

// Données par utilisateur : rendu à la requête.
export const dynamic = 'force-dynamic';

const addSchema = z.object({
  platform: z.enum(PLATFORM_IDS as [string, ...string[]]),
  accountLabel: z.string().trim().min(1).max(120),
  // Sac de credentials brut { champ: valeur } — validé contre les métadonnées.
  fields: z.record(z.string(), z.string()),
});

/** GET — plateformes connectées de l'utilisateur (métadonnées publiques). */
export async function GET() {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  await connectDb();

  const creds = await PlatformCredential.find({ userId: user.id })
    .select('platform accountLabel kind createdAt updatedAt')
    .sort({ updatedAt: -1 })
    .lean();

  return NextResponse.json({
    credentials: creds.map((c) => ({
      id: String(c._id),
      platform: c.platform,
      accountLabel: c.accountLabel,
      kind: c.kind,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    })),
  });
}

/** POST — ajoute (ou remplace) les credentials d'une plateforme, chiffrés. */
export async function POST(request: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 });
  }

  const parsed = addSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Données invalides.', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const meta = getPlatformMeta(parsed.data.platform);
  if (!meta) {
    return NextResponse.json({ error: 'Plateforme non supportée.' }, { status: 400 });
  }

  // Ne conserver que les champs déclarés par la plateforme ; exiger les requis.
  const data: Record<string, string> = {};
  for (const field of meta.fields) {
    const value = parsed.data.fields[field.name]?.trim() ?? '';
    if (!value) {
      return NextResponse.json(
        { error: `Champ requis manquant : ${field.label}.` },
        { status: 400 },
      );
    }
    data[field.name] = value;
  }

  // Chiffrement serveur avec la clé maître : le blob seul touche la base.
  const blob = encryptCredentials(data, getConfig().CREDENTIALS_MASTER_KEY);

  await connectDb();

  // Multi-comptes (P49) : un jeu par (userId, platform, accountLabel). Ré-ajouter
  // le même libellé écrase (upsert sur l'index unique) ; un libellé différent crée
  // un compte supplémentaire (ex. « Udemy FR » + « Udemy EN »).
  const doc = await PlatformCredential.findOneAndUpdate(
    {
      userId: user.id,
      platform: parsed.data.platform,
      accountLabel: parsed.data.accountLabel,
    },
    {
      $set: { kind: meta.kind, data: blob },
      $setOnInsert: {
        userId: user.id,
        platform: parsed.data.platform,
        accountLabel: parsed.data.accountLabel,
      },
    },
    { upsert: true, new: true },
  );

  // Journal d'audit (P149) : changement de credentials plateforme — jamais le
  // secret lui-même, seulement la plateforme et le libellé de compte.
  void recordAudit({
    action: 'credentials.changed',
    userId: user.id,
    targetType: 'platform_credential',
    targetId: String(doc._id),
    ip: extractClientIp(request),
    userAgent: request.headers.get('user-agent') ?? undefined,
    metadata: { platform: doc.platform, accountLabel: doc.accountLabel },
  });

  // Réponse volontairement sans le secret ni le blob.
  return NextResponse.json(
    {
      id: String(doc._id),
      platform: doc.platform,
      accountLabel: doc.accountLabel,
      kind: doc.kind,
    },
    { status: 201 },
  );
}
