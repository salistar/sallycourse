import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireApiUser } from '@/lib/session';
import { rateLimit } from '@/lib/rate-limit';
import { createCourseFromArchive, ImportArchiveError, ImportQuotaError } from '@/lib/import-archive';

/**
 * POST /api/courses/import-archive (Prompt 182) — re-import de l'archive maître
 * anti-lock-in. Reçoit un ZIP en multipart (champ « file »), le décompresse, le
 * VALIDE (schéma zod partagé) et crée un cours neuf pour l'utilisateur connecté
 * (contenu + médias ré-uploadés) SANS aucun LLM. Action lourde → rate-limitée.
 * Le cours est toujours créé au nom de l'utilisateur connecté (pas d'ID d'auteur
 * importé) : impossible de s'approprier le cours d'un tiers.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Taille max de l'archive uploadée (Mo). Chargée en mémoire pour décompression. */
const MAX_MB = 512;

export async function POST(request: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const limited = await rateLimit(`import-archive:user:${user.id}`, { limit: 5, windowSec: 600 }).catch(
    () => ({ allowed: true }) as { allowed: boolean },
  );
  if (!limited.allowed) {
    return NextResponse.json(
      { error: 'Trop d’imports récents, réessayez dans quelques minutes.', code: 'tooManyRecentImports' },
      { status: 429 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError('invalidMultipart');
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return apiError('missingFile');
  }
  if (file.size > MAX_MB * 1024 * 1024) {
    return NextResponse.json({ error: `Archive trop lourde (max ${MAX_MB} Mo).`, code: 'importArchiveArchiveTooLarge', params: { max: MAX_MB } }, { status: 413 });
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ error: 'Lecture du fichier impossible.', code: 'fileReadFailed' }, { status: 400 });
  }

  try {
    const result = await createCourseFromArchive(user.id, buffer);
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (err) {
    if (err instanceof ImportQuotaError) {
      // Quota mensuel atteint : un import consomme un crédit de cours (P53).
      return NextResponse.json({ error: err.message, plan: err.plan, limit: err.limit }, { status: 402 });
    }
    if (err instanceof ImportArchiveError) {
      return NextResponse.json({ error: `Archive invalide : ${err.message}`, code: 'importArchiveInvalidArchive', params: { message: err.message } }, { status: 400 });
    }
    return NextResponse.json(
      { error: 'Échec du re-import, réessayez plus tard.', code: 'reimportFailed' },
      { status: 503 },
    );
  }
}
