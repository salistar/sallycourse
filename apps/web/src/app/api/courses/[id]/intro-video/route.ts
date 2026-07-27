import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import {
  deleteObject,
  objectExists,
  presignedGetUrl,
  uploadObject,
} from '@sallycourse/shared';
import { connectDb, Course as CourseModel } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';

/**
 * /api/courses/[id]/intro-video — gestion de la vidéo d'intro webcam (~60 s)
 * du mode « compliance maximale » Udemy (Prompt 48).
 *  - POST (multipart) : uploade le MP4 vers S3 et pose Course.introVideoKey ;
 *  - GET : URL présignée si une intro existe ;
 *  - DELETE : retire l'objet et le champ.
 * Ownership vérifiée à chaque appel (404 volontaire pour ne rien révéler).
 */

export const dynamic = 'force-dynamic';

/** Clé S3 de la vidéo d'intro d'un cours (miroir de introVideoKey côté worker). */
function introKey(courseId: string): string {
  return `courses/${courseId}/intro/webcam-intro.mp4`;
}

/** Taille max acceptée (Mo) — une intro webcam de 60 s reste modeste. */
const MAX_MB = 200;
const ACCEPTED_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];

/** Charge le cours possédé par l'utilisateur, ou renvoie une Response 404. */
async function loadOwnedCourse(id: string, userId: string) {
  if (!isValidObjectId(id)) {
    return apiError('courseNotFound');
  }
  await connectDb();
  const course = await CourseModel.findOne({ _id: id, userId }).select('_id introVideoKey');
  if (!course) {
    return apiError('courseNotFound');
  }
  return course;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  const course = await loadOwnedCourse(id, user.id);
  if (course instanceof Response) return course;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError('invalidMultipart');
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Fichier vidéo manquant (champ « file »).', code: 'missingVideoFile' }, { status: 400 });
  }
  if (file.type && !ACCEPTED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: 'Format non supporté (MP4, MOV ou WebM attendu).', code: 'unsupportedVideoFormat' },
      { status: 415 },
    );
  }
  if (file.size > MAX_MB * 1024 * 1024) {
    return NextResponse.json({ error: `Vidéo trop lourde (max ${MAX_MB} Mo).`, code: 'introVideoTooLarge', params: { max: MAX_MB } }, { status: 413 });
  }

  const key = introKey(id);
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await uploadObject(key, buffer, file.type || 'video/mp4');
    course.introVideoKey = key;
    await course.save();
  } catch {
    return NextResponse.json(
      { error: 'Échec de l’enregistrement de la vidéo, réessayez.', code: 'videoSaveFailed' },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true, hasIntro: true }, { status: 201 });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  const course = await loadOwnedCourse(id, user.id);
  if (course instanceof Response) return course;

  const key = course.introVideoKey ?? introKey(id);
  try {
    if (!(await objectExists(key))) {
      return NextResponse.json({ hasIntro: false }, { status: 200 });
    }
    const url = await presignedGetUrl(key);
    return NextResponse.json({ hasIntro: true, url }, { status: 200 });
  } catch {
    return NextResponse.json({ hasIntro: false }, { status: 200 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  const course = await loadOwnedCourse(id, user.id);
  if (course instanceof Response) return course;

  const key = course.introVideoKey ?? introKey(id);
  try {
    await deleteObject(key).catch(() => undefined);
    course.introVideoKey = undefined;
    await course.save();
  } catch {
    return NextResponse.json({ error: 'Suppression impossible, réessayez.', code: 'deletionFailed' }, { status: 503 });
  }

  return NextResponse.json({ ok: true, hasIntro: false }, { status: 200 });
}
