// Rendu du filigrane VISIBLE d'une leçon pour UN étudiant (Prompt 206). Paresseux
// (déclenché à la 1re lecture par cet étudiant) et mis en cache dans S3 par
// (leçon × étudiant) : storageKeys…watermarkedVideo(studentId). JAMAIS de rendu
// massif à la génération du cours.
//
// Réutilise le pipeline vidéo existant : runFfmpeg (timeout dur + kill P128),
// getObjectStream/uploadObject/objectExists (storage), et les helpers PURS du
// filigrane (@sallycourse/shared/watermark : filtre drawtext rotatif + args).
//
// Repli PROPRE (décision produit) : si la police .ttf configurée est absente, on
// tente fontconfig ; si le rendu ffmpeg échoue MALGRÉ tout (police introuvable
// en dev Windows, asset corrompu…), on log et on renonce sans jeter côté
// orchestration — la route de lecture sert alors la vidéo NON filigranée. La
// lecture n'est jamais bloquée.
import { createWriteStream } from 'node:fs';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import {
  Lesson,
  Section,
  buildWatermarkDrawtextFilter,
  buildWatermarkFfmpegArgs,
  getConfig,
  getObjectStream,
  objectExists,
  storageKeys,
  uploadObject,
} from '../shared.js';
import { runFfmpeg } from './video-render.js';
import { logger } from '../queues/index.js';

/** Erreur structurée du rendu filigrané (source claire dans les logs). */
export class WatermarkRenderError extends Error {
  constructor(stage: string, message: string) {
    super(`watermark[${stage}] : ${message}`);
    this.name = 'WatermarkRenderError';
  }
}

/**
 * Résout le chemin de police drawtext : renvoie WATERMARK_FONT_FILE s'il existe
 * réellement sur le disque, sinon `undefined` (drawtext bascule sur fontconfig).
 * Ne jette jamais — la résolution de police ne doit pas casser le rendu.
 */
export async function resolveWatermarkFontFile(): Promise<string | undefined> {
  const configured = getConfig().WATERMARK_FONT_FILE;
  try {
    await access(configured, fsConstants.R_OK);
    return configured;
  } catch {
    logger.warn({ configured }, 'watermark : police .ttf introuvable — repli fontconfig');
    return undefined;
  }
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

export interface RenderWatermarkedLessonInput {
  courseId: string;
  lessonId: string;
  studentId: string;
  /** Email affiché en filigrane (identifie la source d'une fuite). */
  studentEmail: string;
}

export interface RenderWatermarkedLessonResult {
  /** Clé S3 de la copie filigranée (présente si rendue ou déjà en cache). */
  watermarkedKey: string;
  /** true si le rendu a été effectué, false si déjà en cache (idempotent). */
  rendered: boolean;
}

/**
 * Rend (ou réutilise le cache) la copie filigranée d'une leçon pour un étudiant.
 * Idempotent : si la clé existe déjà, ne relance rien. Retourne la clé S3 —
 * l'appelant présigne une URL courte vers elle. Jette une WatermarkRenderError
 * en cas d'échec de rendu (le processor gère retry/log ; la route de lecture,
 * elle, sert la vidéo non filigranée en attendant).
 */
export async function renderWatermarkedLesson(
  input: RenderWatermarkedLessonInput,
): Promise<RenderWatermarkedLessonResult> {
  const { courseId, lessonId, studentId, studentEmail } = input;

  const lesson = await Lesson.findById(lessonId).select('sectionId order type assets').lean();
  if (!lesson) throw new WatermarkRenderError('load', `leçon introuvable : ${lessonId}`);
  if (lesson.type !== 'video') throw new WatermarkRenderError('load', `leçon non vidéo : ${lessonId}`);

  const section = await Section.findById(lesson.sectionId).select('order').lean();
  const sectionOrder = section?.order ?? 0;
  const keys = storageKeys.course(courseId).lesson(sectionOrder, lesson.order);
  const watermarkedKey = keys.watermarkedVideo(studentId);

  // Cache par (leçon × étudiant) : déjà rendu → rien à faire.
  if (await objectExists(watermarkedKey)) {
    return { watermarkedKey, rendered: false };
  }

  const sourceKey = lesson.assets?.videoUrl || keys.video();
  const dir = await mkdtemp(path.join(tmpdir(), `wm-${lessonId}-`));
  try {
    const inputPath = path.join(dir, 'source.mp4');
    const ok = await downloadToFile(sourceKey, inputPath);
    if (!ok) throw new WatermarkRenderError('download', `vidéo source absente : ${sourceKey}`);

    const fontFile = await resolveWatermarkFontFile();
    const filter = buildWatermarkDrawtextFilter(studentEmail, { fontFile });
    const outputPath = path.join(dir, 'watermarked.mp4');

    try {
      await runFfmpeg(buildWatermarkFfmpegArgs(inputPath, outputPath, filter));
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new WatermarkRenderError('encode', detail);
    }

    await uploadObject(watermarkedKey, await readFile(outputPath), 'video/mp4');
    logger.info({ courseId, lessonId, studentId, watermarkedKey }, 'copie filigranée rendue et mise en cache');
    return { watermarkedKey, rendered: true };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
