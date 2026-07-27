// Rendu d'une CAPTURE D'ÉCRAN UPLOADÉE par l'auteur (Feature B). Distinct du
// screencast AUTOMATIQUE (media/screenshot-capture.ts, Playwright, indexé par
// étape de TP) : ici l'auteur téléverse SON enregistrement d'écran, saisit un
// texte de narration et des légendes horodatées ; on produit un MP4 final NARRÉ
// (voix du cours) avec les légendes incrustées (drawtext), qui s'AJOUTE comme
// asset screencast de la leçon.
//
// Pipeline d'un job :
//  1. charge Lesson + Section + Course ; passe le statut à 'rendering' ;
//  2. lit l'entrée durable { narrationText, overlays } (JSON en stockage) ;
//  3. télécharge l'enregistrement brut (screencastUpload) ;
//  4. synthétise la narration avec la voix du cours (synthesizeSlide, voix
//     clonée si Course.useCustomVoice + échantillon consenti) → mp3 local ;
//  5. buildScreencastNarrationArgs (primitif pur) → runFfmpeg (H.264/AAC) ;
//  6. upload du MP4 final (screencastRender) ; statut 'ready' + renderKey.
//
// Best-effort / robuste : toute erreur pose screencastStatus='failed' + log,
// sans jamais tuer le worker. En dev Windows sans police .ttf, les légendes sont
// omises (repli propre) plutôt que de casser le rendu (cf. resolveWatermarkFontFile).
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { Job } from 'bullmq';
import {
  Course,
  Lesson,
  Section,
  User,
  getObjectStream,
  screencastRenderInputSchema,
  storageKeys,
  uploadObject,
  type ScreencastOverlay,
  readObjectBuffer,
} from '../shared.js';
import { logger } from '../queues/index.js';
import { synthesizeSlide } from '../media/tts.js';
import { buildScreencastNarrationArgs } from '../media/screencast.js';
import { runFfmpeg } from '../media/video-render.js';
import { resolveWatermarkFontFile } from '../media/watermark.js';
import { planForCourse } from '../queues/plan-lookup.js';

/**
 * Timeout du ré-encodage ffmpeg d'un screencast (ms). Volontairement inférieur
 * au lockDuration du worker (10 min) pour que le verrou BullMQ n'expire pas
 * pendant le rendu (sinon la leçon serait re-rendue en double).
 */
export const SCREENCAST_FFMPEG_TIMEOUT_MS = 8 * 60_000;

/** Nom de la queue dédiée (miroir côté web). */
export const SCREENCAST_RENDER_QUEUE = 'screencast-render';
/** Nom du job de rendu d'une capture uploadée. */
export const SCREENCAST_RENDER_JOB = 'screencast-render-lesson';

export interface ScreencastRenderJobData {
  courseId: string;
  lessonId: string;
}

/** jobId déterministe par leçon : re-poster ne duplique pas le rendu. */
export function screencastRenderJobId(lessonId: string): string {
  return `${SCREENCAST_RENDER_JOB}_${lessonId}`;
}

export interface ScreencastRenderResult {
  courseId: string;
  lessonId: string;
  status: 'ready' | 'failed';
  overlays: number;
}

/** Télécharge un objet S3 vers un fichier local ; false si absent/erreur. */
async function downloadToFile(key: string, dest: string): Promise<boolean> {
  try {
    const stream = (await getObjectStream(key)) as Readable;
    await pipeline(stream, createWriteStream(dest));
    return true;
  } catch {
    return false;
  }
}

// (« stream S3 -> Buffer » factorise dans @sallycourse/shared/storage —
// audit dedup 2026-07-26 : readObjectBuffer/streamToBuffer importes.)

/**
 * Charge l'échantillon de voix clonée du propriétaire (base64) si le cours
 * l'active et que le consentement + l'échantillon existent — même règle que
 * tts-generation. Retourne undefined si non applicable (voix standard).
 */
async function loadClonedVoiceSample(
  course: { userId: unknown; useCustomVoice?: boolean },
): Promise<{ b64: string; id: string } | undefined> {
  if (!course.useCustomVoice) return undefined;
  const owner = await User.findById(String(course.userId))
    .select('voiceSampleUploadedAt voiceCloneConsent')
    .lean();
  if (!owner?.voiceSampleUploadedAt || !owner.voiceCloneConsent) return undefined;
  try {
    const sampleKey = storageKeys.voiceSample(String(course.userId));
    const b64 = (await readObjectBuffer(sampleKey)).toString('base64');
    const id = `${String(course.userId)}:${new Date(owner.voiceSampleUploadedAt).getTime()}`;
    return { b64, id };
  } catch (err) {
    logger.warn({ err }, 'screencast : échantillon de voix clonée introuvable — voix standard');
    return undefined;
  }
}

/**
 * Traite un rendu de capture uploadée. Ne jette JAMAIS pour une erreur de rendu
 * (best-effort) : pose screencastStatus='failed' et retourne un résultat. Jette
 * uniquement si la leçon est introuvable (incohérence de données à remonter).
 */
export async function processScreencastRender(
  job: Job<ScreencastRenderJobData>,
): Promise<ScreencastRenderResult> {
  const { courseId, lessonId } = job.data;
  const lesson = await Lesson.findById(lessonId);
  if (!lesson) throw new Error(`leçon introuvable : ${lessonId}`);

  const fail = async (message: string): Promise<ScreencastRenderResult> => {
    logger.error({ courseId, lessonId, message }, 'screencast : rendu en échec');
    await Lesson.findByIdAndUpdate(lessonId, { 'assets.screencastStatus': 'failed' }).catch(
      () => undefined,
    );
    return { courseId, lessonId, status: 'failed', overlays: 0 };
  };

  lesson.assets.screencastStatus = 'rendering';
  await lesson.save().catch(() => undefined);

  const course = await Course.findById(courseId);
  if (!course) return fail(`cours introuvable : ${courseId}`);
  const section = await Section.findById(lesson.sectionId);
  const sectionOrder = section?.order ?? 0;
  const keys = storageKeys.course(courseId).lesson(sectionOrder, lesson.order);

  // Entrée durable { narrationText, overlays } écrite par la route.
  let narrationText: string;
  let overlays: ScreencastOverlay[];
  try {
    const raw = JSON.parse((await readObjectBuffer(keys.screencastOverlays())).toString('utf-8'));
    const parsed = screencastRenderInputSchema.parse(raw);
    narrationText = parsed.narrationText;
    overlays = parsed.overlays;
  } catch (err) {
    logger.warn({ courseId, lessonId, err }, 'screencast : entrée de rendu illisible');
    return fail('entrée de rendu (narration/légendes) absente ou invalide');
  }

  const dir = await mkdtemp(path.join(tmpdir(), `screencast-${lessonId}-`));
  try {
    // 1) Enregistrement brut uploadé par l'auteur.
    const videoPath = path.join(dir, 'recording.mp4');
    if (!(await downloadToFile(keys.screencastUpload(), videoPath))) {
      return fail('enregistrement d’écran introuvable dans le stockage');
    }

    // 2) Narration TTS avec la voix du cours (voix clonée si activée).
    const plan = await planForCourse(courseId);
    const sample = await loadClonedVoiceSample(course);
    const { cacheKey } = await synthesizeSlide({
      text: narrationText,
      locale: course.locale,
      voice: course.ttsVoice,
      speed: course.narrationSpeed,
      plan,
      ...(sample ? { voiceSampleB64: sample.b64, voiceSampleId: sample.id } : {}),
    });
    const audioPath = path.join(dir, 'narration.mp3');
    await writeFile(audioPath, await readObjectBuffer(cacheKey));

    // 3) Police .ttf des légendes : MÊME config que le filigrane (P206). Absente
    // (dev Windows) → on omet les légendes plutôt que de produire un drawtext
    // cassé (fontfile='' échoue) ; le rendu narré reste produit.
    const fontFile = await resolveWatermarkFontFile();
    const effectiveOverlays = fontFile ? overlays : [];
    if (!fontFile && overlays.length > 0) {
      logger.warn({ courseId, lessonId }, 'screencast : police .ttf absente — légendes omises');
    }

    // 4) Composition (primitif pur) + ffmpeg. Le texte de chaque légende est
    // écrit dans un fichier temporaire et référencé via `textfile=` (anti-injection
    // ffmpeg : le texte auteur ne transite jamais par la chaîne de filtres).
    const textFiles: string[] = [];
    for (let i = 0; i < effectiveOverlays.length; i += 1) {
      const tf = path.join(dir, `overlay-${i}.txt`);
      await writeFile(tf, effectiveOverlays[i]!.text, 'utf-8');
      textFiles.push(tf);
    }
    const outPath = path.join(dir, 'render.mp4');
    const args = buildScreencastNarrationArgs(
      videoPath,
      audioPath,
      effectiveOverlays,
      textFiles,
      outPath,
      fontFile ?? '',
    );
    // Ré-encodage pleine longueur (x264 CPU) d'un enregistrement uploadé pouvant
    // durer plusieurs minutes : timeout large (le worker a lockDuration 10 min).
    await runFfmpeg(args, SCREENCAST_FFMPEG_TIMEOUT_MS);

    // 5) Upload du rendu final + statut 'ready'.
    const renderKey = keys.screencastRender();
    await uploadObject(renderKey, await readFile(outPath), 'video/mp4');

    await Lesson.findByIdAndUpdate(lessonId, {
      'assets.screencastStatus': 'ready',
      'assets.screencastRenderKey': renderKey,
    });

    logger.info(
      { courseId, lessonId, overlays: effectiveOverlays.length, renderKey },
      'screencast : rendu narré prêt',
    );
    return { courseId, lessonId, status: 'ready', overlays: effectiveOverlays.length };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
