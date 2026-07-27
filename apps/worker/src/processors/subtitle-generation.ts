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
  toPlainText,
  toSrt,
  toVtt,
  type Cue,
  type FallbackSlide,
} from '../media/subtitles.js';
// transcribeWithWhisper()/whisperPythonScript() vivent désormais dans
// media/transcribe.ts (Prompt 210) — extraits ici SANS duplication pour être
// partagés avec le processor de dictée vocale. Comportement inchangé.
import { WHISPER_LANGUAGE, transcribeWithWhisper } from '../media/transcribe.js';
import { recordTranscribeCost } from '../lib/cost.js';

export interface SubtitleResult {
  courseId: string;
  lessonId: string;
  cues: number;
  /** Clé S3 du .srt. */
  srtKey: string;
  /** Clé S3 du .vtt. */
  vttKey: string;
  /** Clé S3 de la transcription texte brut (P137, accessibilité). */
  txtKey: string;
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
          // Coût Whisper instrumenté (audit coûts 2026-07-26) : durée d'audio
          // transcrite ≈ fin du dernier segment. Best-effort.
          const audioSeconds = Math.max(0, segments[segments.length - 1]?.end ?? 0);
          await recordTranscribeCost({ courseId }, audioSeconds).catch(() => undefined);
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

    await report(courseId, 85, `Génération des fichiers .srt / .vtt / .txt (${cues.length} sous-titres)`);
    const srtKey = keys.captionsSrt();
    const vttKey = keys.captionsVtt();
    const txtKey = keys.captionsTxt();
    await uploadObject(srtKey, toSrt(cues), 'application/x-subrip; charset=utf-8');
    await uploadObject(vttKey, toVtt(cues), 'text/vtt; charset=utf-8');
    // Transcription texte brut (P137, accessibilité) : téléchargeable à côté
    // des sous-titres, sans timestamps — utile lecteur d'écran / relecture.
    await uploadObject(txtKey, toPlainText(cues), 'text/plain; charset=utf-8');

    lesson.assets.srtUrl = srtKey;
    lesson.assets.vttUrl = vttKey;
    lesson.assets.txtUrl = txtKey;
    await lesson.save();

    await report(courseId, 100, `Sous-titres prêts : ${cues.length} lignes${degraded ? ' (mode dégradé)' : ''}`);
    logger.info({ courseId, lessonId, cues: cues.length, srtKey, vttKey, txtKey, degraded }, 'sous-titres générés');

    // Rétention (P79) : la purge des slides PNG + audio par slide N'A PAS LIEU
    // ici. Ce job tourne par leçon, en parallèle de la finalisation du cours, et
    // les slides/audios sont encore consommés en aval par la réutilisation du
    // contenu (podcast P202, bande-annonce P197). La purge est donc faite une
    // seule fois, à la toute fin de finalizeCourseIfComplete, quand plus aucun
    // générateur n'en a besoin (cf. processors/content-generation.ts).

    return { courseId, lessonId, cues: cues.length, srtKey, vttKey, txtKey, degraded };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ courseId, lessonId, err }, 'échec de la génération des sous-titres');
    await report(courseId, 0, `Échec du sous-titrage : ${message}`, 'error').catch(() => undefined);
    throw err;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
