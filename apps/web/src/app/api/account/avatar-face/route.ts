import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { storageKeys, uploadObject, deleteObject } from '@sallycourse/shared';
import { User as UserModel, connectDb } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';

// /api/account/avatar-face — photo de visage du présentateur pour l'avatar
// « talking-head » (Ditto/Modal). Réutilisée pour tous les cours de l'utilisateur.
//  - POST (multipart) : uploade la photo (portrait frontal) → avatarFace(userId),
//    positionne User.avatarFaceUploadedAt (drapeau de présence) ;
//  - GET : statut (photo présente ? depuis quand ?) ;
//  - DELETE : supprime la photo + reset du drapeau.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_MB = 12;
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

/**
 * POST — upload de la photo de présentateur.
 * Champs multipart : `file` (image PNG/JPEG/WebP, portrait frontal recommandé).
 */
export async function POST(request: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError('invalidMultipart');
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Image manquante (champ « file »).', code: 'missingImage' }, { status: 400 });
  }
  if (file.type && !ACCEPTED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'Format non supporté (PNG, JPEG ou WebP attendu).', code: 'unsupportedImageFormat' }, { status: 415 });
  }
  if (file.size > MAX_MB * 1024 * 1024) {
    return NextResponse.json({ error: `Image trop lourde (max ${MAX_MB} Mo).`, code: 'avatarFaceImageTooLarge', params: { max: MAX_MB } }, { status: 413 });
  }

  await connectDb();
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    await uploadObject(storageKeys.avatarFace(user.id), buffer, file.type || 'image/png');
    const uploadedAt = new Date();
    await UserModel.findByIdAndUpdate(user.id, { avatarFaceUploadedAt: uploadedAt });
    return NextResponse.json({ ok: true, uploadedAt: uploadedAt.toISOString() }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Échec de l’upload de la photo : ${message}`, code: 'avatarFaceUploadFailed', params: { message: message } }, { status: 502 });
  }
}

/** GET — la photo de présentateur est-elle présente ? */
export async function GET() {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  await connectDb();
  const dbUser = await UserModel.findById(user.id).select('avatarFaceUploadedAt').lean();
  if (!dbUser) return apiError('userNotFound');

  return NextResponse.json({
    hasFace: Boolean(dbUser.avatarFaceUploadedAt),
    uploadedAt: dbUser.avatarFaceUploadedAt ? new Date(dbUser.avatarFaceUploadedAt).toISOString() : null,
  });
}

/** DELETE — supprime la photo (best-effort) + reset du drapeau. */
export async function DELETE() {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  await connectDb();
  await deleteObject(storageKeys.avatarFace(user.id)).catch(() => undefined);
  await UserModel.findByIdAndUpdate(user.id, { avatarFaceUploadedAt: undefined });

  return NextResponse.json({ ok: true, hasFace: false });
}
