// Rendu vidéo du doublage (Prompt 92) — isolé de translate-published.ts pour ne
// charger execa/ffmpeg que lorsque le doublage est réellement demandé (dub=true).
// Réutilise les slides PNG déjà rendues du montage source (visuel inchangé) et
// remplace uniquement l'audio de chaque segment par la narration TTS traduite,
// via les mêmes helpers ffmpeg PURS que video-render.ts (buildSegmentArgs,
// buildConcatArgs, buildConcatFile) — aucune duplication de la logique d'assemblage.
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { execa } from 'execa';
import {
  Lesson,
  Section,
  getObjectStream,
  objectExists,
  storageKeys,
  uploadObject,
  type Locale,
} from '../shared.js';
import {
  buildConcatArgs,
  buildConcatFile,
  buildSegmentArgs,
  probeVideo,
  type VideoSegment,
} from '../media/video-render.js';
import { synthesizeSlide } from '../media/tts.js';
import type { Cue } from '../media/subtitles.js';
import { logger } from '../queues/index.js';

/** Télécharge un objet S3 vers un fichier local ; false si absent. */
async function downloadToFile(key: string, dest: string): Promise<boolean> {
  try {
    const stream = (await getObjectStream(key)) as Readable;
    await pipeline(stream, createWriteStream(dest));
    return true;
  } catch {
    return false;
  }
}

export interface RenderDubbedVideoParams {
  courseId: string;
  lessonId: string;
  /** Clé S3 de la vidéo source (sert uniquement à retrouver sectionOrder/lessonOrder via la leçon). */
  sourceVideoKey: string;
  /** Cues traduits (texte cible), timestamps du .srt d'origine — resynthétisés en audio. */
  cues: readonly Cue[];
  locale: Locale;
  ttsVoice?: string;
}

/**
 * Régénère le MP4 doublé d'une leçon : une slide PNG déjà rendue par segment de
 * cue (on suppose un mapping approximatif slide↔cue par index, cohérent avec le
 * montage d'origine — une slide = un cue narratif), audio TTS traduit. Uploadé
 * sous storageKeys…videoLocalized(locale). Retourne la clé S3, ou undefined si
 * les slides source sont introuvables (rendu vidéo pas encore terminé).
 */
export async function renderDubbedVideoFromCues(params: RenderDubbedVideoParams): Promise<string | undefined> {
  const { courseId, lessonId, cues, locale, ttsVoice } = params;
  const lesson = await Lesson.findById(lessonId);
  if (!lesson) return undefined;
  const section = await Section.findById(lesson.sectionId);
  const sectionOrder = section?.order ?? 0;
  const keys = storageKeys.course(courseId).lesson(sectionOrder, lesson.order);

  const dir = await mkdtemp(path.join(tmpdir(), `dub-${lessonId}-${locale}-`));
  try {
    const segments: VideoSegment[] = [];
    for (let i = 0; i < cues.length; i += 1) {
      const cue = cues[i]!;
      const imagePath = path.join(dir, `slide-${i}.png`);
      const okImage = await downloadToFile(keys.slide(i), imagePath);
      if (!okImage) {
        // Pas de slide correspondante (script plus long/court que les cues d'origine) :
        // on arrête le doublage à ce stade plutôt que de produire une vidéo incohérente.
        logger.warn({ courseId, lessonId, locale, index: i }, 'doublage : slide manquante, arrêt du montage');
        break;
      }
      const synth = await synthesizeSlide({ text: cue.text, locale, voice: ttsVoice });
      const audioPath = path.join(dir, `audio-${i}.mp3`);
      const okAudio = await downloadToFile(synth.cacheKey, audioPath);
      segments.push({
        imagePath,
        audioPath: okAudio ? audioPath : null,
        seconds: synth.seconds > 0 ? synth.seconds : Math.max(0.5, cue.end - cue.start),
      });
    }

    if (segments.length === 0) return undefined;

    const segmentPaths: string[] = [];
    for (let i = 0; i < segments.length; i += 1) {
      const out = path.join(dir, `seg-${i}.mp4`);
      await execa('ffmpeg', buildSegmentArgs(segments[i]!, out));
      segmentPaths.push(out);
    }

    const concatList = path.join(dir, 'concat.txt');
    await writeFile(concatList, buildConcatFile(segmentPaths), 'utf8');
    const finalPath = path.join(dir, 'dubbed.mp4');
    await execa('ffmpeg', buildConcatArgs(concatList, finalPath));

    // Vérification légère (durée/résolution) — best-effort, ne bloque pas l'upload.
    await probeVideo(finalPath).catch(() => undefined);

    const videoKey = keys.videoLocalized(locale);
    await uploadObject(videoKey, await readFile(finalPath), 'video/mp4');
    logger.info({ courseId, lessonId, locale, videoKey }, 'vidéo doublée rendue et uploadée');
    return videoKey;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Vrai si les slides source de la leçon existent (au moins la première) — évite un doublage sur une leçon non encore rendue. */
export async function hasRenderedSlides(courseId: string, sectionOrder: number, lessonOrder: number): Promise<boolean> {
  const keys = storageKeys.course(courseId).lesson(sectionOrder, lessonOrder);
  return objectExists(keys.slide(0));
}
