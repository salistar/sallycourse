import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import { apiError } from '@/lib/api-error';
import {
  deleteObject,
  presignedGetUrl,
  slideScriptSchema,
  storageKeys,
  uploadObject,
  type SlideScript,
} from '@sallycourse/shared';
import { connectDb, Course as CourseModel, Lesson as LessonModel, Section as SectionModel } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { extractClientIp, rateLimit } from '@/lib/rate-limit';
import { MANUAL_AUDIO_INTAKE_JOB, getManualAudioIntakeQueue, manualAudioIntakeJobId } from '@/lib/queues';

/**
 * /api/courses/[id]/lessons/[lessonId]/slides/[index]/audio — ENREGISTREMENT
 * AUDIO MANUEL PAR SLIDE (Lot 4, plan 2026-07-20). L'auteur enregistre au
 * micro (hook `useAudioRecorder`, blob webm) ou uploade un fichier ; le
 * fichier brut est stocké puis un job `manual-audio-intake` le normalise
 * (loudnorm -16 LUFS, 48 kHz, mêmes réglages que le TTS) et mesure sa durée
 * réelle. L'enregistrement survit ensuite à toute régénération de la leçon
 * (`tts-generation.ts` copie `manualAudioKey` au lieu de resynthétiser) —
 * appliquer le résultat à la vidéo déjà rendue reste une action SÉPARÉE
 * (bouton « Appliquer à la vidéo » = regenerate {mode:'render-only'}, comme
 * pour l'image de slide, Lot 3).
 *  - POST (multipart `file`) : webm/mp3/wav ≤25 Mo → enqueue la normalisation ;
 *  - GET : statut + URL présignée de l'enregistrement normalisé actuel ;
 *  - DELETE : retire l'override (la slide revient à la narration TTS).
 * Ownership vérifiée à chaque appel (404 volontaire, jamais 403).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_UPLOAD_MB = 25;
const ACCEPTED_UPLOAD_TYPES = ['audio/webm', 'audio/mp3', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/wave'];

// Normalisation ffmpeg (CPU, quelques secondes) : limites généreuses mais bornées.
const INTAKE_USER_LIMIT = { limit: 30, windowSec: 600 };
const INTAKE_IP_LIMIT = { limit: 90, windowSec: 600 };

/** Charge la leçon possédée par l'utilisateur + son script vidéo validé + l'index de slide. 404 volontaire sinon. */
async function loadOwnedSlide(courseId: string, lessonId: string, indexRaw: string, userId: string) {
  const index = Number.parseInt(indexRaw, 10);
  if (!isValidObjectId(courseId) || !isValidObjectId(lessonId) || !Number.isInteger(index) || index < 0) {
    return apiError('lessonNotFound');
  }
  await connectDb();
  const course = await CourseModel.findOne({ _id: courseId, userId }).select('_id');
  if (!course) return apiError('lessonNotFound');
  const lesson = await LessonModel.findOne({ _id: lessonId, courseId });
  if (!lesson || lesson.type !== 'video') return apiError('lessonNotFound');

  const parsed = slideScriptSchema.safeParse(lesson.script);
  if (!parsed.success || !parsed.data.slides[index]) {
    return apiError('lessonNotFound');
  }
  const section = await SectionModel.findById(lesson.sectionId).select('order').lean();
  if (!section) return apiError('lessonNotFound');

  const keys = storageKeys.course(courseId).lesson(section.order, lesson.order);
  return { lesson, script: parsed.data as SlideScript, index, keys };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; lessonId: string; index: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const ip = extractClientIp(request);
  const [userLimit, ipLimit] = await Promise.all([
    rateLimit(`manual-audio:user:${user.id}`, INTAKE_USER_LIMIT),
    rateLimit(`manual-audio:ip:${ip}`, INTAKE_IP_LIMIT),
  ]);
  const hit = !userLimit.allowed ? userLimit : !ipLimit.allowed ? ipLimit : null;
  if (hit) {
    return NextResponse.json(
      { error: 'Trop d’enregistrements envoyés, réessayez plus tard.', code: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((hit.resetAt.getTime() - Date.now()) / 1000)) } },
    );
  }

  const { id, lessonId, index: indexParam } = await params;
  const loaded = await loadOwnedSlide(id, lessonId, indexParam, user.id);
  if (loaded instanceof Response) return loaded;
  const { lesson, script, index, keys } = loaded;

  const declaredLength = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declaredLength) && declaredLength > (MAX_UPLOAD_MB + 2) * 1024 * 1024) {
    return NextResponse.json(
      { error: `Enregistrement trop lourd (max ${MAX_UPLOAD_MB} Mo).`, code: 'manualAudioTooLargeDeclared' },
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
    return NextResponse.json({ error: 'Audio manquant (champ « file »).', code: 'missingAudioFile' }, { status: 400 });
  }
  if (!ACCEPTED_UPLOAD_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: 'Format non supporté (WebM, MP3 ou WAV attendu).', code: 'unsupportedAudioFormat' },
      { status: 415 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'Enregistrement vide.', code: 'emptyAudio' }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    return NextResponse.json(
      { error: `Enregistrement trop lourd (max ${MAX_UPLOAD_MB} Mo).`, code: 'manualAudioTooLarge' },
      { status: 413 },
    );
  }

  const rawKey = keys.manualAudioRaw(index);
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await uploadObject(rawKey, buffer, file.type);
  } catch {
    return NextResponse.json({ error: 'Échec du stockage de l’enregistrement.', code: 'audioStorageFailed' }, { status: 502 });
  }

  const slide = script.slides[index]!;
  slide.audioStatus = 'pending';
  script.slides[index] = slide;
  lesson.script = script;
  lesson.markModified('script');
  await lesson.save();

  try {
    const queue = getManualAudioIntakeQueue();
    await queue.remove(manualAudioIntakeJobId(lessonId, index)).catch(() => undefined);
    await queue.add(
      MANUAL_AUDIO_INTAKE_JOB,
      { courseId: id, lessonId, index },
      { jobId: manualAudioIntakeJobId(lessonId, index), removeOnComplete: 50, removeOnFail: 100 },
    );
  } catch {
    slide.audioStatus = 'failed';
    script.slides[index] = slide;
    lesson.script = script;
    lesson.markModified('script');
    await lesson.save().catch(() => undefined);
    return NextResponse.json(
      { error: 'Impossible de démarrer l’intégration, réessayez plus tard.', code: 'manualAudioStartFailed' },
      { status: 503 },
    );
  }

  return NextResponse.json({ status: 'pending' }, { status: 202 });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; lessonId: string; index: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id, lessonId, index: indexParam } = await params;
  const loaded = await loadOwnedSlide(id, lessonId, indexParam, user.id);
  if (loaded instanceof Response) return loaded;
  const { script, index } = loaded;
  const slide = script.slides[index]!;

  let url: string | undefined;
  if (slide.manualAudioKey) {
    url = await presignedGetUrl(slide.manualAudioKey).catch(() => undefined);
  }

  return NextResponse.json(
    {
      status: slide.audioStatus ?? 'idle',
      url,
      source: slide.audioSource ?? 'tts',
      seconds: slide.audioSeconds ?? null,
    },
    { status: 200 },
  );
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; lessonId: string; index: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id, lessonId, index: indexParam } = await params;
  const loaded = await loadOwnedSlide(id, lessonId, indexParam, user.id);
  if (loaded instanceof Response) return loaded;
  const { lesson, script, index, keys } = loaded;

  await Promise.all([
    deleteObject(keys.manualAudioRaw(index)).catch(() => undefined),
    deleteObject(keys.manualAudio(index)).catch(() => undefined),
  ]);

  const slide = script.slides[index]!;
  slide.manualAudioKey = undefined;
  slide.audioSource = undefined;
  slide.audioStatus = undefined;
  script.slides[index] = slide;
  lesson.script = script;
  lesson.markModified('script');
  await lesson.save();

  return NextResponse.json({ status: 'idle', source: 'tts' }, { status: 200 });
}
