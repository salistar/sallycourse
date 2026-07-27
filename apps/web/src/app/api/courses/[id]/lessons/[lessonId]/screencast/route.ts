import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import {
  deleteObject,
  getObjectStream,
  presignedGetUrl,
  storageKeys,
  uploadObject,
} from '@sallycourse/shared/storage';
import { screencastRenderInputSchema } from '@sallycourse/shared/schemas/screencast';
import { connectDb, Course as CourseModel, Lesson as LessonModel, Section as SectionModel } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { extractClientIp, rateLimit } from '@/lib/rate-limit';
import { getScreencastRenderQueue, SCREENCAST_RENDER_JOB, screencastRenderJobId } from '@/lib/queues';

/**
 * /api/courses/[id]/lessons/[lessonId]/screencast — CAPTURE D'ÉCRAN UPLOADÉE
 * (Feature B). L'auteur téléverse un enregistrement d'écran (MP4) + un texte de
 * narration + des légendes horodatées ; on stocke le tout, on passe la leçon en
 * 'pending' et on enfile un job screencast-render (narration TTS avec la voix du
 * cours + incrustation des légendes via ffmpeg). Le worker n'expose aucun HTTP :
 * le client POLLE ensuite GET. Distinct du screencast AUTOMATIQUE (Playwright).
 *  - POST (multipart) : upload MP4 + narrationText + overlays JSON → enqueue ;
 *  - GET : statut du rendu + URL présignée du MP4 final + narration/légendes ;
 *  - DELETE : retire les assets de capture et remet le statut à zéro.
 * Ownership vérifiée à chaque appel (404 volontaire pour ne rien révéler).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Taille max de l'enregistrement uploadé (Mo). */
const MAX_MB = 500;
const ACCEPTED_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];

// Le rendu déclenche TTS + un ré-encodage ffmpeg : limites serrées.
const RENDER_USER_LIMIT = { limit: 20, windowSec: 600 };
const RENDER_IP_LIMIT = { limit: 60, windowSec: 600 };

/**
 * Charge la leçon possédée par l'utilisateur (leçon ∈ cours ∈ user) + l'ordre de
 * section (clés de stockage). Renvoie une Response 404 en cas d'accès invalide.
 */
async function loadOwnedLesson(courseId: string, lessonId: string, userId: string) {
  if (!isValidObjectId(courseId) || !isValidObjectId(lessonId)) {
    return apiError('lessonNotFound');
  }
  await connectDb();
  const course = await CourseModel.findOne({ _id: courseId, userId }).select('_id locale ttsVoice narrationSpeed useCustomVoice');
  if (!course) {
    return apiError('lessonNotFound');
  }
  const lesson = await LessonModel.findOne({ _id: lessonId, courseId });
  if (!lesson) {
    return apiError('lessonNotFound');
  }
  const section = await SectionModel.findById(lesson.sectionId).select('order').lean();
  const keys = storageKeys.course(courseId).lesson(section?.order ?? 0, lesson.order);
  return { course, lesson, keys };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; lessonId: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const ip = extractClientIp(request);
  const [userLimit, ipLimit] = await Promise.all([
    rateLimit(`screencast:user:${user.id}`, RENDER_USER_LIMIT),
    rateLimit(`screencast:ip:${ip}`, RENDER_IP_LIMIT),
  ]);
  const hit = !userLimit.allowed ? userLimit : !ipLimit.allowed ? ipLimit : null;
  if (hit) {
    return NextResponse.json(
      { error: 'Trop de rendus demandés, réessayez plus tard.', code: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((hit.resetAt.getTime() - Date.now()) / 1000)) } },
    );
  }

  const { id, lessonId } = await params;
  const loaded = await loadOwnedLesson(id, lessonId, user.id);
  if (loaded instanceof Response) return loaded;
  const { lesson, keys } = loaded;

  // Pré-contrôle de taille AVANT request.formData() : celui-ci bufferise tout le
  // corps multipart en mémoire (undici, pas de spill disque). On rejette d'abord
  // sur Content-Length déclaré pour ne pas matérialiser un upload géant.
  const declaredLength = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declaredLength) && declaredLength > (MAX_MB + 8) * 1024 * 1024) {
    return NextResponse.json({ error: `Enregistrement trop lourd (max ${MAX_MB} Mo).`, code: 'screencastRecordingTooLargeDeclared', params: { max: MAX_MB } }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError('invalidMultipart');
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Enregistrement manquant (champ « file »).', code: 'missingRecording' }, { status: 400 });
  }
  // Pas de court-circuit sur file.type falsy : un Content-Type vide/absent est
  // REFUSÉ (sinon un fichier non vidéo sans type passe le contrôle).
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'Format non supporté (MP4, MOV ou WebM attendu).', code: 'unsupportedVideoFormat' }, { status: 415 });
  }
  if (file.size === 0) {
    return apiError('emptyRecording');
  }
  if (file.size > MAX_MB * 1024 * 1024) {
    return NextResponse.json({ error: `Enregistrement trop lourd (max ${MAX_MB} Mo).`, code: 'screencastRecordingTooLarge', params: { max: MAX_MB } }, { status: 413 });
  }

  // narrationText + overlays (JSON) validés par le schéma PARTAGÉ.
  const overlaysRaw = form.get('overlays');
  let overlaysParsed: unknown = [];
  if (typeof overlaysRaw === 'string' && overlaysRaw.trim()) {
    try {
      overlaysParsed = JSON.parse(overlaysRaw);
    } catch {
      return NextResponse.json({ error: 'Légendes JSON invalides.', code: 'invalidJsonCaptions' }, { status: 400 });
    }
  }
  const input = screencastRenderInputSchema.safeParse({
    narrationText: typeof form.get('narrationText') === 'string' ? form.get('narrationText') : '',
    overlays: overlaysParsed,
  });
  if (!input.success) {
    return NextResponse.json(
      { error: 'Narration ou légendes invalides.', code: 'invalidNarrationOrCaptions', details: input.error.flatten() },
      { status: 400 },
    );
  }

  // Upload de l'enregistrement brut + de l'entrée de rendu durable (JSON).
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await uploadObject(keys.screencastUpload(), buffer, file.type || 'video/mp4');
    await uploadObject(
      keys.screencastOverlays(),
      Buffer.from(JSON.stringify(input.data), 'utf-8'),
      'application/json; charset=utf-8',
    );
  } catch {
    return NextResponse.json({ error: 'Échec du stockage de l’enregistrement.', code: 'recordingStorageFailed' }, { status: 502 });
  }

  // Persiste les légendes (rechargement UI) + statut, PUIS enfile le rendu.
  lesson.assets.screencastStatus = 'pending';
  lesson.assets.screencastOverlays = input.data.overlays;
  lesson.assets.screencastRenderKey = undefined;
  lesson.markModified('assets');
  await lesson.save();

  try {
    // jobId déterministe par leçon : BullMQ REFUSE d'ajouter un job dont le hash
    // existe encore (job complété/échoué retenu par removeOnComplete/Fail). Sans
    // le retirer d'abord, un RE-rendu de la même leçon serait silencieusement
    // ignoré et resterait « pending » à jamais. On purge le job résiduel (no-op
    // s'il tourne encore — on ne double alors pas un rendu en cours).
    const queue = getScreencastRenderQueue();
    await queue.remove(screencastRenderJobId(lessonId)).catch(() => undefined);
    await queue.add(
      SCREENCAST_RENDER_JOB,
      { courseId: id, lessonId },
      { jobId: screencastRenderJobId(lessonId), removeOnComplete: 50, removeOnFail: 100 },
    );
  } catch {
    lesson.assets.screencastStatus = 'failed';
    lesson.markModified('assets');
    await lesson.save().catch(() => undefined);
    return NextResponse.json(
      { error: 'Impossible de démarrer le rendu, réessayez plus tard.', code: 'renderStartFailed' },
      { status: 503 },
    );
  }

  return NextResponse.json({ status: 'pending' }, { status: 201 });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; lessonId: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id, lessonId } = await params;
  const loaded = await loadOwnedLesson(id, lessonId, user.id);
  if (loaded instanceof Response) return loaded;
  const { lesson, keys } = loaded;

  const status = lesson.assets.screencastStatus ?? 'idle';
  const overlays = Array.isArray(lesson.assets.screencastOverlays) ? lesson.assets.screencastOverlays : [];

  // narrationText relu depuis l'entrée durable (best-effort, pour ré-éditer).
  let narrationText = '';
  try {
    const stream = await getObjectStream(keys.screencastOverlays());
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const json = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    if (typeof json?.narrationText === 'string') narrationText = json.narrationText;
  } catch {
    // Pas encore d'entrée : narrationText reste vide (première utilisation).
  }

  let url: string | undefined;
  if (status === 'ready' && lesson.assets.screencastRenderKey) {
    url = await presignedGetUrl(lesson.assets.screencastRenderKey).catch(() => undefined);
  }

  return NextResponse.json({ status, url, overlays, narrationText }, { status: 200 });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; lessonId: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id, lessonId } = await params;
  const loaded = await loadOwnedLesson(id, lessonId, user.id);
  if (loaded instanceof Response) return loaded;
  const { lesson, keys } = loaded;

  await Promise.all([
    deleteObject(keys.screencastUpload()).catch(() => undefined),
    deleteObject(keys.screencastOverlays()).catch(() => undefined),
    deleteObject(keys.screencastRender()).catch(() => undefined),
  ]);

  lesson.assets.screencastStatus = undefined;
  lesson.assets.screencastRenderKey = undefined;
  lesson.assets.screencastOverlays = undefined;
  lesson.markModified('assets');
  await lesson.save();

  return NextResponse.json({ status: 'idle' }, { status: 200 });
}
