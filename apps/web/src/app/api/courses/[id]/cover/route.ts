import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import { apiError } from '@/lib/api-error';
import { presignedGetUrl, storageKeys, uploadObject } from '@sallycourse/shared';
import { connectDb, Course as CourseModel } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';

/**
 * /api/courses/[id]/cover — image de couverture du cours (2026-07-26).
 *  - POST (multipart `file`) : remplace la couverture par un fichier uploadé
 *    par l'auteur (synchrone, PNG/JPEG/WebP) → `course.coverImageUrl` ;
 *  - GET : URL présignée de la couverture actuelle (custom ou hero marketing) ;
 *  - DELETE : retire la couverture custom, revient au hero SDXL marketing s'il
 *    existe (sinon aucune couverture).
 * Ownership vérifiée (404 volontaire, jamais 403). La couverture custom est
 * stockée sous marketing/cover-custom.* pour survivre à la purge des slides.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_UPLOAD_MB = 8;
const ACCEPTED_UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const EXT_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** Charge le cours possédé par l'utilisateur (404 volontaire sinon). */
async function loadOwnedCourse(courseId: string, userId: string) {
  if (!isValidObjectId(courseId)) return apiError('courseNotFound');
  await connectDb();
  const course = await CourseModel.findOne({ _id: courseId, userId });
  if (!course) return apiError('courseNotFound');
  return course;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  const course = await loadOwnedCourse(id, user.id);
  if (course instanceof Response) return course;

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return apiError('invalidMultipart');
  }

  const declaredLength = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declaredLength) && declaredLength > (MAX_UPLOAD_MB + 2) * 1024 * 1024) {
    return NextResponse.json(
      { error: `Image trop lourde (max ${MAX_UPLOAD_MB} Mo).`, code: 'slideImageTooLargeDeclared' },
      { status: 413 },
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
    return NextResponse.json({ error: 'Image manquante (champ « file »).', code: 'missingFile' }, { status: 400 });
  }
  if (!ACCEPTED_UPLOAD_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: 'Format non supporté (PNG, JPEG ou WebP attendu).', code: 'unsupportedImageFormat' },
      { status: 415 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'Image vide.', code: 'emptyImage' }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    return NextResponse.json(
      { error: `Image trop lourde (max ${MAX_UPLOAD_MB} Mo).`, code: 'slideImageTooLarge' },
      { status: 413 },
    );
  }

  const ext = EXT_BY_TYPE[file.type] ?? 'png';
  const key = storageKeys.course(id).marketing(`cover-custom.${ext}`);
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await uploadObject(key, buffer, file.type);
  } catch {
    return NextResponse.json({ error: 'Échec du stockage de l’image.', code: 'imageStorageFailed' }, { status: 502 });
  }

  course.coverImageUrl = key;
  await course.save();

  const url = await presignedGetUrl(key).catch(() => undefined);
  return NextResponse.json({ status: 'ready', source: 'uploaded', url }, { status: 200 });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  const course = await loadOwnedCourse(id, user.id);
  if (course instanceof Response) return course;

  const key = typeof course.coverImageUrl === 'string' ? course.coverImageUrl : undefined;
  const url = key ? await presignedGetUrl(key).catch(() => undefined) : undefined;
  const isCustom = typeof key === 'string' && key.includes('cover-custom.');
  return NextResponse.json({ url, source: isCustom ? 'uploaded' : url ? 'generated' : null }, { status: 200 });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  const course = await loadOwnedCourse(id, user.id);
  if (course instanceof Response) return course;

  // Revient au hero SDXL marketing si présent, sinon aucune couverture.
  const marketing = course.marketing as { assets?: { heroCover?: unknown } } | undefined;
  const hero = typeof marketing?.assets?.heroCover === 'string' ? marketing.assets.heroCover : undefined;
  course.coverImageUrl = hero;
  await course.save();

  const url = hero ? await presignedGetUrl(hero).catch(() => undefined) : undefined;
  return NextResponse.json({ url, source: hero ? 'generated' : null }, { status: 200 });
}
