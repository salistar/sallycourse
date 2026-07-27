import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { z } from 'zod';
import { createCourseInputSchema } from '@sallycourse/shared/schemas/course';
import { connectDb, GenerationPreset } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';

/**
 * /api/generation-presets — presets de GÉNÉRATION nommés (Phase 10, P163/174).
 * GET  : mes presets + presets publics d'autres utilisateurs.
 * POST : crée un preset { name, params (sous-ensemble de createCourseInput sans
 * title), isPublic? } — réappliqué en un clic à la création d'un cours.
 */

export const dynamic = 'force-dynamic';

// Params = createCourseInput sans le titre, tous les champs optionnels.
const presetParamsSchema = createCourseInputSchema.omit({ title: true }).partial();

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  params: presetParamsSchema,
  isPublic: z.boolean().optional().default(false),
});

function toPublicPreset(doc: {
  _id: unknown;
  name: string;
  params: unknown;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: String(doc._id),
    name: doc.name,
    params: doc.params ?? {},
    isPublic: doc.isPublic,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/** GET — mes presets + presets publics. */
export async function GET() {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  await connectDb();
  const [mine, publicOnes] = await Promise.all([
    GenerationPreset.find({ userId: user.id }).sort({ updatedAt: -1 }).lean(),
    GenerationPreset.find({ isPublic: true, userId: { $ne: user.id } })
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean(),
  ]);

  return NextResponse.json({
    presets: mine.map(toPublicPreset),
    publicPresets: publicOnes.map(toPublicPreset),
  });
}

/** POST — crée un preset de génération. */
export async function POST(request: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('invalidJson');
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Données invalides.', code: 'invalidData', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectDb();
  const doc = await GenerationPreset.create({
    userId: user.id,
    name: parsed.data.name,
    params: parsed.data.params,
    isPublic: parsed.data.isPublic,
  });

  return NextResponse.json({ preset: toPublicPreset(doc) }, { status: 201 });
}
