// Processor BullMQ « subtitle-generation » (Prompt 25) : produit les
// sous-titres .srt + .vtt d'une leçon vidéo.
//
// Pipeline nominal :
//  1. récupère le script (Lesson.script → slides + narration) et la locale ;
//  2. télécharge le média rendu (video.mp4) ou, à défaut, concatène les mp3
//     de slides existants dans un fichier temporaire ;
//  3. transcrit avec faster-whisper via un sous-processus Python (word_timestamps),
//     langue forcée depuis Course.locale ;
//  4. RÉALIGNE les segments sur la narration d'origine (timestamps Whisper +
//     texte source) → cues ;
//  5. génère .srt et .vtt, les upload (captionsSrt/Vtt) et renseigne Lesson.assets.
//
// Repli (MOCK_PROVIDERS, WHISPER_BIN absent, aucun média, ou échec Python) :
//  sous-titres dérivés DIRECTEMENT du script, découpés par slide selon la durée
//  audio (mesurée ou estimée). Qualité dégradée mais texte exact — warning émis.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { Job } from 'bullmq';
import { execa } from 'execa';
import {
  Course,
  Lesson,
  QUEUES,
  Section,
  getConfig,
  getObjectStream,
  publishProgress,
  slideScriptSchema,
  storageKeys,
  uploadObject,
  type SubtitleJobData,
} from '../shared.js';
import { getRedisConnection } from '../queues/connection.js';
import { logger } from '../queues/index.js';
import {
  alignToReference,
  subtitlesFromScript,
  toSrt,
  toVtt,
  type Cue,
  type FallbackSlide,
  type WhisperSegment,
} from '../media/subtitles.js';

/** Modèle faster-whisper : « small » = bon compromis vitesse/qualité sur CPU. */
const WHISPER_MODEL = 'small';
/** Codes langue faster-whisper (ISO 639-1) par locale du cours. */
const WHISPER_LANGUAGE: Record<string, string> = { fr: 'fr', en: 'en', ar: 'ar' };

export interface SubtitleResult {
  courseId: string;
  lessonId: string;
  cues: number;
  /** Clé S3 du .srt. */
  srtKey: string;
  /** Clé S3 du .vtt. */
  vttKey: string;
  /** true si les sous-titres proviennent du repli script (Whisper non utilisé). */
  degraded: boolean;
}

/** Publie la progression du step subtitle-generation (best-effort). */
async function report(
  courseId: string,
  progress: number,
  message: string,
  level: 'info' | 'warn' | 'error' = 'info',
): Promise<void> {
  try {
    await publishProgress(getRedisConnection(), {
      courseId,
      step: QUEUES.subtitle,
      progress,
      message,
      level,
      ts: Date.now(),
    });
  } catch (err) {
    logger.warn({ courseId, err }, 'publication de progression impossible');
  }
}

/** Télécharge un objet S3 vers un fichier local ; retourne false si absent. */
async function downloadToFile(key: string, dest: string): Promise<boolean> {
  try {
    const stream = (await getObjectStream(key)) as Readable;
    await pipeline(stream, createWriteStream(dest));
    return true;
  } catch {
    // Objet inexistant (média pas encore rendu) : le repli prendra le relais.
    return false;
  }
}

/**
 * Prépare le fichier média à transcrire dans `dir` : préfère la vidéo rendue,
 * sinon concatène les mp3 de slides (concat "binaire" : les mp3 se lisent
 * bout à bout, suffisant pour la transcription). Retourne le chemin ou null.
 */
async function prepareMediaFile(
  courseId: string,
  sectionOrder: number,
  lessonOrder: number,
  slideCount: number,
  dir: string,
): Promise<string | null> {
  const keys = storageKeys.course(courseId).lesson(sectionOrder, lessonOrder);

  const videoPath = path.join(dir, 'lesson.mp4');
  if (await downloadToFile(keys.video(), videoPath)) return videoPath;

  // Pas de vidéo : on tente les pistes audio des slides (produites par le TTS).
  const audioBuffers: Buffer[] = [];
  for (let slide = 0; slide < slideCount; slide += 1) {
    const audioPath = path.join(dir, `audio-${slide}.mp3`);
    if (await downloadToFile(keys.audio(slide), audioPath)) {
      audioBuffers.push(await readFile(audioPath));
    }
  }
  if (audioBuffers.length === 0) return null;

  const concatPath = path.join(dir, 'audio.mp3');
  await writeFile(concatPath, Buffer.concat(audioBuffers));
  return concatPath;
}

/** Script Python inline : faster-whisper → JSON de segments sur stdout. */
function whisperPythonScript(): string {
  return [
    'import json, sys',
    'from faster_whisper import WhisperModel',
    'media_path, model_name, language = sys.argv[1], sys.argv[2], sys.argv[3]',
    "model = WhisperModel(model_name, device='cpu', compute_type='int8')",
    'segments, _ = model.transcribe(media_path, language=language, word_timestamps=True)',
    'out = [{"start": s.start, "end": s.end, "text": s.text} for s in segments]',
    'sys.stdout.write(json.dumps(out))',
  ].join('\n');
}

/**
 * Transcrit un média via faster-whisper (sous-processus Python). Retourne les
 * segments, ou null si le binaire Python / le module est indisponible (repli).
 */
async function transcribeWithWhisper(
  mediaPath: string,
  language: string,
  dir: string,
): Promise<WhisperSegment[] | null> {
  const bin = process.env.WHISPER_BIN ?? 'python';
  const scriptPath = path.join(dir, 'whisper_transcribe.py');
  await writeFile(scriptPath, whisperPythonScript(), 'utf8');

  try {
    const { stdout } = await execa(bin, [scriptPath, mediaPath, WHISPER_MODEL, language], {
      // Transcription CPU longue : pas de timeout agressif (le job BullMQ borne déjà).
      timeout: 0,
    });
    const parsed = JSON.parse(stdout) as WhisperSegment[];
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (s) => typeof s?.start === 'number' && typeof s?.end === 'number' && typeof s?.text === 'string',
    );
  } catch (err) {
    logger.warn({ mediaPath, err }, 'faster-whisper indisponible ou en échec — repli sur le script');
    return null;
  }
}

/** Extrait la liste ordonnée des narrations d'un Lesson.script (video). */
function narrationSlides(script: unknown): FallbackSlide[] {
  const parsed = slideScriptSchema.safeParse(script);
  if (!parsed.success) return [];
  return parsed.data.slides.map((slide) => ({ narration: slide.narration }));
}

/** Processor de la queue subtitle-generation (un job = une leçon vidéo). */
export async function processSubtitleGeneration(job: Job<SubtitleJobData>): Promise<SubtitleResult> {
  const { courseId, lessonId } = job.data;

  await report(courseId, 5, 'Chargement de la leçon pour le sous-titrage');
  const lesson = await Lesson.findById(lessonId);
  if (!lesson) throw new Error(`leçon introuvable : ${lessonId}`);
  if (lesson.type !== 'video') {
    throw new Error(`processSubtitleGeneration : leçon ${lessonId} de type « ${lesson.type} » (attendu : video)`);
  }
  const course = await Course.findById(courseId);
  if (!course) throw new Error(`cours introuvable : ${courseId}`);

  const slides = narrationSlides(lesson.script);
  if (slides.length === 0) {
    throw new Error(`leçon ${lessonId} sans script vidéo exploitable — génère le script avant les sous-titres`);
  }

  const section = await Section.findById(lesson.sectionId);
  const sectionOrder = section?.order ?? 0;
  const keys = storageKeys.course(courseId).lesson(sectionOrder, lesson.order);
  const language = WHISPER_LANGUAGE[course.locale] ?? course.locale;

  const config = getConfig();
  const dir = await mkdtemp(path.join(tmpdir(), `subtitles-${lessonId}-`));
  try {
    let cues: Cue[] = [];
    let degraded = true;

    // Mode mock : court-circuit total de Whisper (sous-titres dérivés du script).
    if (!config.MOCK_PROVIDERS) {
      await report(courseId, 25, 'Récupération du média rendu');
      const mediaPath = await prepareMediaFile(courseId, sectionOrder, lesson.order, slides.length, dir);
      if (mediaPath) {
        await report(courseId, 45, `Transcription faster-whisper (${language})`);
        const segments = await transcribeWithWhisper(mediaPath, language, dir);
        if (segments && segments.length > 0) {
          await report(courseId, 70, 'Réalignement de la transcription sur le script');
          cues = alignToReference(segments, slides.map((s) => s.narration));
          degraded = cues.length === 0; // alignement vide → repli
        }
      }
    }

    if (degraded || cues.length === 0) {
      await report(
        courseId,
        70,
        'Sous-titres dérivés du script (faster-whisper indisponible ou média absent) — timings approximatifs',
        'warn',
      );
      cues = subtitlesFromScript(slides);
      degraded = true;
    }

    await report(courseId, 85, `Génération des fichiers .srt / .vtt (${cues.length} sous-titres)`);
    const srtKey = keys.captionsSrt();
    const vttKey = keys.captionsVtt();
    await uploadObject(srtKey, toSrt(cues), 'application/x-subrip; charset=utf-8');
    await uploadObject(vttKey, toVtt(cues), 'text/vtt; charset=utf-8');

    lesson.assets.srtUrl = srtKey;
    lesson.assets.vttUrl = vttKey;
    await lesson.save();

    await report(courseId, 100, `Sous-titres prêts : ${cues.length} lignes${degraded ? ' (mode dégradé)' : ''}`);
    logger.info({ courseId, lessonId, cues: cues.length, srtKey, vttKey, degraded }, 'sous-titres générés');
    return { courseId, lessonId, cues: cues.length, srtKey, vttKey, degraded };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ courseId, lessonId, err }, 'échec de la génération des sous-titres');
    await report(courseId, 0, `Échec du sous-titrage : ${message}`, 'error').catch(() => undefined);
    throw err;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
