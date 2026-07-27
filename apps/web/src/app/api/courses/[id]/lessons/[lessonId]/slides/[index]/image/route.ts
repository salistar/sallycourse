import { NextResponse } from 'next/server';
import { z } from 'zod';
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
import { SLIDE_IMAGE_JOB, getSlideImageQueue, slideImageJobId } from '@/lib/queues';

/**
 * /api/courses/[id]/lessons/[lessonId]/slides/[index]/image — image SDXL PAR
 * SLIDE (Lot 3, plan 2026-07-20) :
 *  - POST (JSON `{ prompt? }`) : régénère l'image via SDXL (Modal), en file
 *    d'attente (peut prendre jusqu'à quelques minutes en cold-start GPU) ;
 *  - POST (multipart `file`) : remplace l'image par un fichier uploadé par
 *    l'auteur — synchrone, aucune file d'attente nécessaire ;
 *  - GET : statut + URL présignée de l'image actuelle (polling après POST JSON) ;
 *  - DELETE : retire l'override (la slide revient au motif par défaut du gabarit).
 * Ownership vérifiée à chaque appel (404 volontaire, jamais 403).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_UPLOAD_MB = 8;
const ACCEPTED_UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

// Appel Modal GPU (cold-start possible) : limites serrées, cohérentes avec les
// autres actions à la demande de ce lot (audio-repair, screencast).
const REGEN_USER_LIMIT = { limit: 20, windowSec: 600 };
const REGEN_IP_LIMIT = { limit: 60, windowSec: 600 };

const regenerateBodySchema = z.object({
  prompt: z.string().trim().min(1).max(500).optional(),
  /** Moteur cible (bouton « essayer l'autre moteur », audit qualité modèles 2026-07-22, additif). */
  targetEngine: z.enum(['sdxl', 'zimage']).optional(),
});

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

  const { id, lessonId, index: indexParam } = await params;
  const loaded = await loadOwnedSlide(id, lessonId, indexParam, user.id);
  if (loaded instanceof Response) return loaded;
  const { lesson, script, index, keys } = loaded;

  const contentType = request.headers.get('content-type') ?? '';

  // ── Remplacement manuel (upload) — synchrone, pas de file d'attente. ──────
  if (contentType.includes('multipart/form-data')) {
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

    const key = keys.slideIllustration(index);
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      await uploadObject(key, buffer, file.type);
    } catch {
      return NextResponse.json({ error: 'Échec du stockage de l’image.', code: 'imageStorageFailed' }, { status: 502 });
    }

    const slide = script.slides[index]!;
    slide.imageKey = key;
    slide.imageSource = 'uploaded';
    slide.imageStatus = 'ready';
    script.slides[index] = slide;
    lesson.script = script;
    lesson.markModified('script');
    await lesson.save();

    return NextResponse.json({ status: 'ready', source: 'uploaded' }, { status: 200 });
  }

  // ── Régénération SDXL — asynchrone (queue), body JSON optionnel. ─────────
  const ip = extractClientIp(request);
  const [userLimit, ipLimit] = await Promise.all([
    rateLimit(`slide-image:user:${user.id}`, REGEN_USER_LIMIT),
    rateLimit(`slide-image:ip:${ip}`, REGEN_IP_LIMIT),
  ]);
  const hit = !userLimit.allowed ? userLimit : !ipLimit.allowed ? ipLimit : null;
  if (hit) {
    return NextResponse.json(
      { error: 'Trop de régénérations demandées, réessayez plus tard.', code: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((hit.resetAt.getTime() - Date.now()) / 1000)) } },
    );
  }

  const parsedBody = regenerateBodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsedBody.success) {
    return NextResponse.json({ error: 'Prompt invalide.', code: 'invalidImagePrompt' }, { status: 400 });
  }
  const { prompt, targetEngine } = parsedBody.data;

  const slide = script.slides[index]!;
  slide.imageStatus = 'pending';
  script.slides[index] = slide;
  lesson.script = script;
  lesson.markModified('script');
  await lesson.save();

  try {
    const queue = getSlideImageQueue();
    await queue.remove(slideImageJobId(lessonId, index)).catch(() => undefined);
    await queue.add(
      SLIDE_IMAGE_JOB,
      { courseId: id, lessonId, index, ...(prompt ? { prompt } : {}), ...(targetEngine ? { targetEngine } : {}) },
      { jobId: slideImageJobId(lessonId, index), removeOnComplete: 50, removeOnFail: 100 },
    );
  } catch {
    slide.imageStatus = 'failed';
    script.slides[index] = slide;
    lesson.script = script;
    lesson.markModified('script');
    await lesson.save().catch(() => undefined);
    return NextResponse.json(
      { error: 'Impossible de démarrer la régénération, réessayez plus tard.', code: 'slideImageStartFailed' },
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
  if (slide.imageKey) {
    url = await presignedGetUrl(slide.imageKey).catch(() => undefined);
  }

  return NextResponse.json(
    {
      status: slide.imageStatus ?? 'idle',
      url,
      prompt: slide.imagePrompt ?? '',
      source: slide.imageSource ?? null,
      // Moteur ACTUEL de cette slide (audit qualité modèles 2026-07-22, additif).
      engine: slide.imageEngine ?? 'sdxl',
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

  await deleteObject(keys.slideIllustration(index)).catch(() => undefined);

  const slide = script.slides[index]!;
  slide.imageKey = undefined;
  slide.imagePrompt = undefined;
  slide.imageSeed = undefined;
  slide.imageSource = undefined;
  slide.imageStatus = undefined;
  slide.imageEngine = undefined;
  script.slides[index] = slide;
  lesson.script = script;
  lesson.markModified('script');
  await lesson.save();

  return NextResponse.json({ status: 'idle' }, { status: 200 });
}
