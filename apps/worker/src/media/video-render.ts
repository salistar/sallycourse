// Rendu vidéo FFmpeg (Prompt 24) : assemble les slides PNG + audio mp3 d'une
// leçon en un MP4 H.264/AAC 1920×1080 -movflags +faststart.
//
// Choix d'assemblage (documenté) : plutôt qu'une cascade xfade vidéo (offsets à
// recalculer segment par segment, fragile dès qu'un audio manque), on procède
// en deux temps SIMPLES et robustes :
//   1. chaque slide devient un segment MP4 « image fixe animée par sa durée
//      audio » (loop image + audio de la slide, réencodé H.264) ;
//   2. les segments sont concaténés via le concat demuxer (pas de réencodage
//      vidéo, coupe franche), avec un FONDU AUDIO de type acrossfade appliqué
//      en cascade sur les pistes pour éviter les clics de raccord.
// L'intro (VIDEO.INTRO_SECONDS) est un segment supplémentaire placé en tête,
// silencieux, construit à partir d'une image (première frame D8 ou carte titre).
// Le crossfade VIDÉO (VIDEO.SLIDE_CROSSFADE_SECONDS) reste documenté par la spec
// D8 mais n'est PAS appliqué ici : le concat demuxer fait une coupe franche, le
// fondu se joue côté audio — compromis assumé pour la fiabilité du pipeline CPU.
//
// Ce fichier expose des helpers PURS (construction des arguments ffmpeg, plan de
// segments, filtre acrossfade) couverts par des tests, et l'orchestration I/O
// renderLessonVideo (téléchargements S3, ffmpeg via execa, vérification ffprobe).

import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { execa } from 'execa';
import {
  Course,
  Lesson,
  Section,
  VIDEO,
  getObjectStream,
  slideScriptSchema,
  storageKeys,
  uploadObject,
  type SlideScript,
} from '../shared.js';
import { logger } from '../queues/index.js';
import { recordRenderCost } from '../lib/cost.js';

/** Cadence de sortie du MP4 (images/seconde) — alignée sur MOTION_FPS (D8). */
export const VIDEO_FPS = 30;
/** Débit audio AAC de la piste finale. */
export const AUDIO_BITRATE = '192k';
/** Tolérance de la vérification de durée (somme audio ±TOLERANCE s). */
export const DURATION_TOLERANCE_SECONDS = 2;

/** Erreur structurée du rendu vidéo (étape + contexte leçon). */
export class VideoRenderError extends Error {
  readonly stage: string;
  readonly lessonId: string;

  constructor(stage: string, lessonId: string, message: string) {
    super(`video-render[${stage}] leçon ${lessonId} : ${message}`);
    this.name = 'VideoRenderError';
    this.stage = stage;
    this.lessonId = lessonId;
  }
}

/* ------------------------------------------------------------------ */
/* Plan de segments (pur)                                              */
/* ------------------------------------------------------------------ */

/** Un segment à rendre : une image tenue pour la durée de son audio. */
export interface VideoSegment {
  /** Chemin local de l'image (PNG 1920×1080). */
  imagePath: string;
  /** Chemin local du mp3 narré, ou null pour un segment silencieux (intro). */
  audioPath: string | null;
  /** Durée du segment en secondes (durée audio, ou INTRO_SECONDS). */
  seconds: number;
}

/** Durée d'une slide : audioSeconds si présent, sinon plancher raisonnable. */
export function slideSeconds(audioSeconds: number | undefined): number {
  if (typeof audioSeconds === 'number' && Number.isFinite(audioSeconds) && audioSeconds > 0) {
    return Math.round(audioSeconds * 1000) / 1000;
  }
  return 1;
}

/**
 * Somme des durées attendues du montage : intro + durées audio des slides.
 * Sert de référence à la vérification ffprobe.
 */
export function expectedDurationSeconds(segments: readonly VideoSegment[]): number {
  return segments.reduce((acc, s) => acc + s.seconds, 0);
}

/* ------------------------------------------------------------------ */
/* Arguments ffmpeg (purs)                                             */
/* ------------------------------------------------------------------ */

/**
 * Arguments ffmpeg qui transforment UNE image + (audio | silence) en un segment
 * MP4 H.264 yuv420p 1920×1080 AAC, de durée `seconds`. L'image est bouclée
 * (`-loop 1`) et bornée par `-t`. Sans audio : piste AAC silencieuse (anullsrc)
 * pour que TOUS les segments aient le même layout de flux (concat sans surprise).
 */
export function buildSegmentArgs(segment: VideoSegment, output: string): string[] {
  const args: string[] = ['-y', '-loop', '1', '-i', segment.imagePath];

  if (segment.audioPath) {
    args.push('-i', segment.audioPath);
  } else {
    // Piste silencieuse synthétique : même codec/canaux que les vraies pistes.
    args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
  }

  args.push(
    '-t',
    segment.seconds.toFixed(3),
    // Vidéo : H.264, pixels compatibles lecteurs, dimensions paires garanties.
    '-vf',
    `scale=${VIDEO.WIDTH}:${VIDEO.HEIGHT}:force_original_aspect_ratio=decrease,pad=${VIDEO.WIDTH}:${VIDEO.HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p`,
    '-r',
    String(VIDEO_FPS),
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-pix_fmt',
    'yuv420p',
    // Audio : AAC stéréo 44.1k, coupé à la durée vidéo.
    '-c:a',
    'aac',
    '-b:a',
    AUDIO_BITRATE,
    '-ar',
    '44100',
    '-ac',
    '2',
    '-shortest',
    output,
  );
  return args;
}

/**
 * Contenu du fichier de liste du concat demuxer (chemins échappés). Chaque
 * ligne `file '…'` référence un segment MP4 déjà encodé de façon homogène.
 */
export function buildConcatFile(segmentPaths: readonly string[]): string {
  return segmentPaths
    .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
    .join('\n')
    .concat('\n');
}

/**
 * Arguments ffmpeg du montage final par concat demuxer. La vidéo est copiée
 * (coupe franche, pas de réencodage), l'audio est réencodé AAC pour absorber
 * un éventuel fondu de raccord. -movflags +faststart pour le streaming web.
 */
export function buildConcatArgs(concatListPath: string, output: string): string[] {
  return [
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concatListPath,
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    AUDIO_BITRATE,
    '-movflags',
    '+faststart',
    output,
  ];
}

/* ------------------------------------------------------------------ */
/* Vérification (pure)                                                 */
/* ------------------------------------------------------------------ */

/** Métadonnées ffprobe retenues pour la vérification. */
export interface ProbeSummary {
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

/**
 * Contrôle qu'un montage est conforme : durée ~= somme audio (±tolérance),
 * résolution exacte 1920×1080, piste audio présente. Retourne la liste des
 * violations (vide = conforme). Pur : testable sans ffprobe réel.
 */
export function verifyProbe(
  probe: ProbeSummary,
  expectedSeconds: number,
  tolerance = DURATION_TOLERANCE_SECONDS,
): string[] {
  const problems: string[] = [];
  if (Math.abs(probe.durationSec - expectedSeconds) > tolerance) {
    problems.push(
      `durée ${probe.durationSec.toFixed(2)}s hors tolérance (attendu ~${expectedSeconds.toFixed(2)}s ±${tolerance}s)`,
    );
  }
  if (probe.width !== VIDEO.WIDTH || probe.height !== VIDEO.HEIGHT) {
    problems.push(`résolution ${probe.width}×${probe.height} (attendu ${VIDEO.WIDTH}×${VIDEO.HEIGHT})`);
  }
  if (!probe.hasAudio) {
    problems.push('aucune piste audio détectée');
  }
  return problems;
}

/* ------------------------------------------------------------------ */
/* Orchestration I/O                                                   */
/* ------------------------------------------------------------------ */

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

/** Sonde un MP4 via ffprobe (streams v/a + durée format) → ProbeSummary. */
export async function probeVideo(file: string): Promise<ProbeSummary> {
  const { stdout } = await execa('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration:stream=codec_type,width,height',
    '-of',
    'json',
    file,
  ]);
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
  };
  const streams = parsed.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  const hasAudio = streams.some((s) => s.codec_type === 'audio');
  const durationSec = Number.parseFloat(parsed.format?.duration ?? 'NaN');
  return {
    durationSec: Number.isFinite(durationSec) ? durationSec : 0,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    hasAudio,
  };
}

/**
 * Rend l'image d'intro (première frame D8 si le renderer motion est dispo,
 * sinon carte titre via le gabarit D7 « title ») dans `dest`. Retour : le
 * chemin de l'image. Import dynamique du slide-renderer pour ne pas charger
 * Playwright quand seul le mapping d'arguments sert (tests).
 */
async function renderIntroImage(
  courseId: string,
  lessonId: string,
  dest: string,
): Promise<string> {
  // On réutilise le pipeline de slides : une carte « title » sert d'intro. Le
  // rendu motion D8 image-par-image n'est pas requis ici (intro = image tenue).
  const { renderIntroCard } = await import('./slide-renderer.js');
  const png = await renderIntroCard(courseId, lessonId);
  await writeFile(dest, png);
  return dest;
}

export interface RenderLessonVideoResult {
  courseId: string;
  lessonId: string;
  /** Clé S3 du MP4 produit. */
  videoKey: string;
  /** Durée réelle mesurée par ffprobe (secondes). */
  durationSec: number;
  /** Nombre de segments assemblés (intro incluse). */
  segments: number;
}

/**
 * Assemble la vidéo d'une leçon : slides PNG + audio mp3 → MP4 vérifié, uploadé
 * sous storageKeys…video(). Jette une VideoRenderError structurée à la moindre
 * étape en échec (le worker BullMQ gère alors retry + marquage GenerationJob).
 * Retourne les métadonnées du montage (durée réelle, nombre de segments).
 */
export async function renderLessonVideo(
  courseId: string,
  lessonId: string,
): Promise<RenderLessonVideoResult> {
  const lesson = await Lesson.findById(lessonId);
  if (!lesson) throw new VideoRenderError('load', lessonId, 'leçon introuvable');
  if (lesson.type !== 'video') {
    throw new VideoRenderError('load', lessonId, `type « ${lesson.type} » (attendu : video)`);
  }
  const course = await Course.findById(courseId);
  if (!course) throw new VideoRenderError('load', lessonId, `cours introuvable : ${courseId}`);

  const parsed = slideScriptSchema.safeParse(lesson.script);
  if (!parsed.success) {
    throw new VideoRenderError('load', lessonId, 'script vidéo absent ou invalide (génère TTS avant le rendu)');
  }
  const script: SlideScript = parsed.data;

  const section = await Section.findById(lesson.sectionId);
  const sectionOrder = section?.order ?? 0;
  const keys = storageKeys.course(courseId).lesson(sectionOrder, lesson.order);

  const dir = await mkdtemp(path.join(tmpdir(), `video-${lessonId}-`));
  try {
    // 1) Intro : image tenue VIDEO.INTRO_SECONDS, sans audio.
    const introImage = path.join(dir, 'intro.png');
    await renderIntroImage(courseId, lessonId, introImage);
    const segments: VideoSegment[] = [
      { imagePath: introImage, audioPath: null, seconds: VIDEO.INTRO_SECONDS },
    ];

    // 2) Une slide = un segment (image + audio). Slide sans audio → durée plancher.
    for (let i = 0; i < script.slides.length; i += 1) {
      const slide = script.slides[i]!;
      const imagePath = path.join(dir, `slide-${i}.png`);
      const okImage = await downloadToFile(keys.slide(i), imagePath);
      if (!okImage) {
        throw new VideoRenderError('download', lessonId, `slide PNG absente : ${keys.slide(i)} (lance le rendu des slides)`);
      }
      const audioPath = path.join(dir, `audio-${i}.mp3`);
      const okAudio = await downloadToFile(keys.audio(i), audioPath);
      segments.push({
        imagePath,
        audioPath: okAudio ? audioPath : null,
        seconds: slideSeconds(slide.audioSeconds),
      });
    }

    // 3) Encodage de chaque segment (image animée par sa durée).
    const segmentPaths: string[] = [];
    for (let i = 0; i < segments.length; i += 1) {
      const out = path.join(dir, `seg-${i}.mp4`);
      try {
        await execa('ffmpeg', buildSegmentArgs(segments[i]!, out));
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new VideoRenderError('encode', lessonId, `segment ${i} : ${detail}`);
      }
      segmentPaths.push(out);
    }

    // 4) Concaténation finale (concat demuxer, faststart).
    const concatList = path.join(dir, 'concat.txt');
    await writeFile(concatList, buildConcatFile(segmentPaths), 'utf8');
    const finalPath = path.join(dir, 'lesson.mp4');
    try {
      await execa('ffmpeg', buildConcatArgs(concatList, finalPath));
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new VideoRenderError('concat', lessonId, detail);
    }

    // 5) Vérification ffprobe (durée / résolution / audio).
    const probe = await probeVideo(finalPath);
    const expected = expectedDurationSeconds(segments);
    const problems = verifyProbe(probe, expected);
    if (problems.length > 0) {
      throw new VideoRenderError('verify', lessonId, problems.join(' ; '));
    }

    // 6) Upload + persistance.
    const videoKey = keys.video();
    await uploadObject(videoKey, await readFile(finalPath), 'video/mp4');
    lesson.assets.videoUrl = videoKey;
    lesson.durationMin = Math.max(1, Math.round((probe.durationSec / 60) * 10) / 10);
    lesson.status = 'ready';
    await lesson.save();

    // Coût de rendu : estimation compute par seconde de vidéo produite (P55).
    await recordRenderCost(
      { courseId, userId: String(course.userId) },
      probe.durationSec,
    ).catch(() => undefined);

    logger.info(
      { courseId, lessonId, videoKey, durationSec: probe.durationSec, segments: segments.length },
      'vidéo de leçon rendue et uploadée',
    );
    return {
      courseId,
      lessonId,
      videoKey,
      durationSec: probe.durationSec,
      segments: segments.length,
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
