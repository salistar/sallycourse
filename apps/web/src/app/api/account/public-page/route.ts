import { NextResponse } from 'next/server';
import { z } from 'zod';
import { connectDb, User as UserModel } from '@sallycourse/db';
import { instructorPath, validateHandle } from '@sallycourse/shared/instructor';
import { requireApiUser } from '@/lib/session';

/**
 * PATCH /api/account/public-page — réserve/modifie le handle de la page
 * instructeur publique (Prompt 205). Le handle est UNIQUE (index Mongo) et
 * validé côté serveur : format + liste de mots réservés (routes racine) +
 * unicité. Tant qu'aucun handle n'est posé, l'utilisateur n'a pas de page
 * publique — aucune donnée n'est exposée.
 */

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  handle: z.string().trim().min(1).max(40),
});

/** Erreur d'unicité Mongo (course entre deux réservations concurrentes). */
function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}

export async function PATCH(request: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Handle manquant.', code: 'missingHandle' }, { status: 400 });
  }

  const handle = parsed.data.handle.replace(/^@/, '').trim().toLowerCase();
  const validation = validateHandle(handle);
  if (!validation.valid) {
    return NextResponse.json(
      {
        error:
          validation.error === 'reserved'
            ? 'Ce nom est réservé par la plateforme.'
            : 'Format invalide : 3 à 30 caractères, minuscules, chiffres, tiret ou underscore.',
        code: validation.error,
      },
      { status: 400 },
    );
  }

  await connectDb();

  // Unicité applicative (message clair) — l'index unique reste le garde-fou
  // final en cas de réservation concurrente (voir catch ci-dessous).
  const taken = await UserModel.findOne({ handle }).select('_id').lean();
  if (taken && String(taken._id) !== user.id) {
    return NextResponse.json(
      { error: 'Ce handle est déjà pris.', code: 'taken' },
      { status: 409 },
    );
  }

  try {
    await UserModel.updateOne({ _id: user.id }, { $set: { handle } });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return NextResponse.json(
        { error: 'Ce handle est déjà pris.', code: 'taken' },
        { status: 409 },
      );
    }
    throw error;
  }

  return NextResponse.json({ handle, path: instructorPath(handle) });
}
