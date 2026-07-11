import { NextResponse } from 'next/server';
import { z } from 'zod';
import { connectDb, DeployPreset, DEPLOYMENT_MODES } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { isKnownPlatform } from '@/lib/deploy-catalog';

/**
 * /api/deploy-presets — marketplace de préconfiguration de déploiement (P109).
 * GET  : presets de l'utilisateur + presets publics partagés par d'autres.
 * POST : crée un preset (depuis la config actuelle d'un déploiement existant
 * ou saisie manuelle) — { name, platforms:[{platform,mode,accountLabel}],
 * pricing?, templateRefs?, isPublic? }.
 */

// Données par utilisateur : rendu à la requête.
export const dynamic = 'force-dynamic';

const platformEntrySchema = z.object({
  platform: z.string().trim().min(1),
  mode: z.enum(DEPLOYMENT_MODES as unknown as [string, ...string[]]).default('auto'),
  accountLabel: z.string().trim().min(1).max(120).optional(),
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  platforms: z.array(platformEntrySchema).min(1).max(9),
  pricing: z
    .object({
      currency: z.string().trim().max(8).optional(),
      amount: z.number().min(0).optional(),
      note: z.string().trim().max(280).optional(),
    })
    .optional(),
  templateRefs: z.array(z.string().trim().min(1)).max(20).optional(),
  isPublic: z.boolean().optional().default(false),
});

/** Forme exposée au client (jamais de champ interne superflu). */
function toPublicPreset(doc: {
  _id: unknown;
  userId: unknown;
  name: string;
  platforms: { platform: string; mode: string; accountLabel?: string }[];
  pricing?: { currency?: string; amount?: number; note?: string };
  templateRefs?: string[];
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: String(doc._id),
    name: doc.name,
    platforms: doc.platforms,
    pricing: doc.pricing ?? null,
    templateRefs: doc.templateRefs ?? [],
    isPublic: doc.isPublic,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/** GET — mes presets + presets publics d'autres utilisateurs. */
export async function GET() {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  await connectDb();

  const [mine, publicOnes] = await Promise.all([
    DeployPreset.find({ userId: user.id }).sort({ updatedAt: -1 }).lean(),
    DeployPreset.find({ isPublic: true, userId: { $ne: user.id } })
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean(),
  ]);

  return NextResponse.json({
    presets: mine.map(toPublicPreset),
    publicPresets: publicOnes.map(toPublicPreset),
  });
}

/** POST — crée (ou remplace) un preset de déploiement. */
export async function POST(request: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Données invalides.', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const unknown = parsed.data.platforms
    .map((p) => p.platform)
    .filter((p) => !isKnownPlatform(p));
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: `Plateforme(s) inconnue(s) : ${unknown.join(', ')}.` },
      { status: 400 },
    );
  }

  await connectDb();

  const doc = await DeployPreset.create({
    userId: user.id,
    name: parsed.data.name,
    platforms: parsed.data.platforms,
    pricing: parsed.data.pricing,
    templateRefs: parsed.data.templateRefs ?? [],
    isPublic: parsed.data.isPublic,
  });

  return NextResponse.json({ preset: toPublicPreset(doc) }, { status: 201 });
}
