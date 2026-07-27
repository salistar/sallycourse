import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isValidObjectId } from 'mongoose';
import { apiError } from '@/lib/api-error';
import { connectDb, Course as CourseModel, Lesson as LessonModel } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { extractClientIp, rateLimit } from '@/lib/rate-limit';
import { AUDIO_REPAIR_JOB, audioRepairJobId, getAudioRepairQueue } from '@/lib/queues';

/**
 * /api/courses/[id]/lessons/[lessonId]/audio-repair — bouton « Réparer
 * l'audio » (Lot 2, plan 2026-07-20) d'une leçon vidéo DÉJÀ générée : après la
 * purge P79, plus aucun mp3/PNG par slide n'existe en S3 — la réparation
 * repart de `Lesson.script.slides[].narration` (mode 'resynth', diagnostic
 * ciblé + resynthèse des seules slides fautives) ou traite directement la
 * piste audio de la vidéo finale (mode 'denoise', rapide, aucun re-render).
 *  - POST { mode: 'resynth' | 'denoise' } : enfile la réparation ;
 *  - GET : statut + dernier rapport (polling).
 * Ownership vérifiée à chaque appel (404 volontaire, jamais 403).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Débruitage : ffmpeg seul, quelques secondes. Resynthèse : peut rappeler un
// provider TTS payant (Modal/ElevenLabs) sur plusieurs slides + re-render.
// Limites serrées, cohérentes avec le rendu de capture (screencast).
const REPAIR_USER_LIMIT = { limit: 10, windowSec: 600 };
const REPAIR_IP_LIMIT = { limit: 30, windowSec: 600 };

const bodySchema = z.union([
  z.object({ mode: z.enum(['resynth', 'denoise']) }),
  // 'switch-voice' (audit qualité modèles 2026-07-22, additif) : bouton
  // « essayer l'autre voix » à côté de « Réparer l'audio » — bascule TOUTES
  // les slides de la leçon vers le moteur cible, sans diagnostic préalable.
  z.object({ mode: z.literal('switch-voice'), targetEngine: z.enum(['chatterbox', 'qwen3']) }),
]);

/** Charge la leçon possédée par l'utilisateur (leçon ∈ cours ∈ user). 404 volontaire sinon. */
async function loadOwnedVideoLesson(courseId: string, lessonId: string, userId: string) {
  if (!isValidObjectId(courseId) || !isValidObjectId(lessonId)) {
    return apiError('lessonNotFound');
  }
  await connectDb();
  const course = await CourseModel.findOne({ _id: courseId, userId }).select('_id ttsEngine');
  if (!course) return apiError('lessonNotFound');
  const lesson = await LessonModel.findOne({ _id: lessonId, courseId });
  if (!lesson) return apiError('lessonNotFound');
  return { lesson, course };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; lessonId: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const ip = extractClientIp(request);
  const [userLimit, ipLimit] = await Promise.all([
    rateLimit(`audio-repair:user:${user.id}`, REPAIR_USER_LIMIT),
    rateLimit(`audio-repair:ip:${ip}`, REPAIR_IP_LIMIT),
  ]);
  const hit = !userLimit.allowed ? userLimit : !ipLimit.allowed ? ipLimit : null;
  if (hit) {
    return NextResponse.json(
      { error: 'Trop de réparations demandées, réessayez plus tard.', code: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((hit.resetAt.getTime() - Date.now()) / 1000)) } },
    );
  }

  const { id, lessonId } = await params;
  const loaded = await loadOwnedVideoLesson(id, lessonId, user.id);
  if (loaded instanceof Response) return loaded;
  const { lesson } = loaded;

  const parsedBody = bodySchema.safeParse(await request.json().catch(() => undefined));
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: 'Mode invalide (« resynth », « denoise » ou « switch-voice » attendu).', code: 'invalidAudioRepairMode' },
      { status: 400 },
    );
  }
  const { mode } = parsedBody.data;
  const targetEngine = 'targetEngine' in parsedBody.data ? parsedBody.data.targetEngine : undefined;

  if (lesson.type !== 'video') {
    return NextResponse.json(
      { error: 'Cette leçon n’est pas une vidéo.', code: 'lessonNotVideo' },
      { status: 400 },
    );
  }
  if (!lesson.assets?.videoUrl) {
    return NextResponse.json(
      { error: 'Cette leçon n’a pas encore de vidéo rendue à réparer.', code: 'noVideoToRepair' },
      { status: 409 },
    );
  }

  lesson.assets.audioRepairStatus = 'pending';
  lesson.assets.audioRepairReport = undefined;
  lesson.markModified('assets');
  await lesson.save();

  try {
    // jobId déterministe par leçon : une réparation déjà en file (ou terminée/
    // échouée, retenue par removeOnComplete/Fail) est purgée avant re-ajout —
    // sans ça BullMQ ignore silencieusement le nouvel add() et le statut reste
    // 'pending' indéfiniment.
    const queue = getAudioRepairQueue();
    await queue.remove(audioRepairJobId(lessonId)).catch(() => undefined);
    await queue.add(
      AUDIO_REPAIR_JOB,
      { courseId: id, lessonId, mode, ...(targetEngine ? { targetEngine } : {}) },
      { jobId: audioRepairJobId(lessonId), removeOnComplete: 50, removeOnFail: 100 },
    );
  } catch {
    lesson.assets.audioRepairStatus = 'failed';
    lesson.assets.audioRepairReport = { mode, ranAt: new Date(), error: 'file d’attente indisponible' };
    lesson.markModified('assets');
    await lesson.save().catch(() => undefined);
    return NextResponse.json(
      { error: 'Impossible de démarrer la réparation, réessayez plus tard.', code: 'audioRepairStartFailed' },
      { status: 503 },
    );
  }

  return NextResponse.json({ status: 'pending', mode }, { status: 202 });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; lessonId: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id, lessonId } = await params;
  const loaded = await loadOwnedVideoLesson(id, lessonId, user.id);
  if (loaded instanceof Response) return loaded;
  const { lesson, course } = loaded;

  return NextResponse.json(
    {
      status: lesson.assets?.audioRepairStatus ?? 'idle',
      report: lesson.assets?.audioRepairReport ?? null,
      // Moteur de voix ACTUEL de cette leçon (audit qualité modèles 2026-07-22,
      // additif) — base du bouton « essayer l'autre voix ».
      currentEngine: lesson.assets?.ttsEngine ?? course.ttsEngine ?? 'chatterbox',
    },
    { status: 200 },
  );
}
