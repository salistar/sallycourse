// Processor BullMQ « screenshot-capture » (Prompt 21).
// Consomme { courseId, lessonId } : lit le TP de la leçon (Lesson.script conforme
// à tpSchema), et pour chaque step.screenshotSpec :
//   1. rejoue la spec dans Playwright (contexte isolé 1920x1080, garde SSRF) ;
//   2. habille la capture BRUTE de façon ÉDITORIALE via annotateScreenshot
//      (@sallycourse/design) puis compose l'overlay SVG avec sharp ;
//   3. uploade sous storageKeys…screenshot(i) et remplit Lesson.assets.screenshots ;
//   4. remplace les placeholders {{screenshot:…}} de l'article de la leçon liée.
// Chaque étape est isolée : une capture en échec est journalisée (GenerationJob.logs)
// sans faire échouer les autres. Enregistré avec concurrency 1 dans index.ts.
import type { Job } from 'bullmq';
import sharp from 'sharp';
import type { Readable } from 'node:stream';
import {
  Course,
  GenerationJob,
  Lesson,
  QUEUES,
  Section,
  annotateScreenshot,
  extractScreenshotPlaceholders,
  getObjectStream,
  publishProgress,
  storageKeys,
  tpSchema,
  uploadObject,
  zoomInsetMaskSvg,
  type AnnotationSpecInput,
  type ScreenshotJobData,
  type TpContent,
  type TpScreenshotSpec,
} from '../shared.js';
import { getRedisConnection } from '../queues/connection.js';
import { logger } from '../queues/index.js';
import {
  captureFromSpec,
  launchCaptureBrowser,
  type CapturedScreenshot,
} from '../media/screenshot-capture.js';

export interface ScreenshotCaptureResult {
  courseId: string;
  lessonId: string;
  /** Nombre de captures produites et uploadées. */
  captured: number;
  /** Nombre d'étapes en échec (journalisées, non bloquantes). */
  failed: number;
  /** Placeholders {{screenshot:…}} remplacés dans l'article lié. */
  placeholdersReplaced: number;
}

/** Publie la progression + journalise dans GenerationJob (best-effort). */
async function report(
  courseId: string,
  progress: number,
  message: string,
  level: 'info' | 'warn' | 'error' = 'info',
): Promise<void> {
  try {
    await publishProgress(getRedisConnection(), {
      courseId,
      step: QUEUES.screenshot,
      progress,
      message,
      level,
      ts: Date.now(),
    });
  } catch (err) {
    logger.warn({ courseId, err }, 'publication de progression impossible');
  }
  try {
    await GenerationJob.updateOne(
      { courseId, step: QUEUES.screenshot },
      {
        $set: { progress },
        $push: { logs: { ts: new Date(), level, msg: message } },
      },
      { upsert: true },
    );
  } catch (err) {
    logger.warn({ courseId, err }, 'mise à jour GenerationJob impossible');
  }
}

/** Agrège un stream lisible en un Buffer. */
async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Construit la spec d'annotation ÉDITORIALE à partir de la capture brute et de
 * la légende de la spec TP. Volontairement sobre : pastille + surbrillance
 * douce autour du focusSelector n'est pas rejouable ici (coordonnées inconnues
 * après capture d'élément), on s'en tient au cadre + légende signés.
 */
export function buildAnnotationSpec(
  captured: CapturedScreenshot,
  spec: TpScreenshotSpec,
  stepNumber: number,
): AnnotationSpecInput {
  return {
    screenshot: { width: captured.width, height: captured.height },
    theme: 'dark',
    lang: 'fr',
    backdrop: 'surfaceSubtle',
    caption: {
      label: `Étape ${stepNumber}`,
      text: spec.caption,
      align: 'start',
    },
  };
}

/**
 * Compose la capture BRUTE avec l'habillage éditorial (overlay SVG) via sharp,
 * en respectant le contrat de annotateScreenshot :
 *   base transparente → capture → (loupe masquée) → overlay SVG.
 * Retourne le PNG final habillé.
 */
export async function composeAnnotated(
  captured: CapturedScreenshot,
  annotationInput: AnnotationSpecInput,
): Promise<Buffer> {
  const ann = annotateScreenshot(annotationInput);

  const layers: sharp.OverlayOptions[] = [
    {
      input: captured.buffer,
      left: Math.round(ann.imagePlacement.left),
      top: Math.round(ann.imagePlacement.top),
    },
  ];

  // Loupe optionnelle : extrait agrandi de la capture brute, masqué en cercle.
  if (ann.zoomInsetPlacement) {
    const zoom = ann.zoomInsetPlacement;
    const enlarged = await sharp(captured.buffer)
      .extract(zoom.extract)
      .resize(zoom.size, zoom.size, { fit: 'fill' })
      .composite([
        {
          input: Buffer.from(zoomInsetMaskSvg(zoom.size)),
          blend: 'dest-in',
        },
      ])
      .png()
      .toBuffer();
    layers.push({ input: enlarged, left: zoom.composite.left, top: zoom.composite.top });
  }

  // Overlay plein cadre par-dessus (fond, ombre, annotations, légende).
  layers.push({ input: Buffer.from(ann.overlaySvg), left: 0, top: 0 });

  return sharp({
    create: {
      width: ann.canvasWidth,
      height: ann.canvasHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(layers)
    .png()
    .toBuffer();
}

/** Étapes du TP portant une screenshotSpec, dans l'ordre du script. */
function stepsWithSpec(tp: TpContent): TpScreenshotSpec[] {
  return tp.steps
    .map((step) => step.screenshotSpec)
    .filter((spec): spec is TpScreenshotSpec => Boolean(spec));
}

/**
 * Remplace les placeholders {{screenshot:…}} de l'article de la leçon liée par
 * des images Markdown pointant vers les captures uploadées. La leçon liée est
 * l'article de la MÊME section (s'il existe) ; l'appariement se fait dans
 * l'ordre : i-ème placeholder ↔ i-ème capture. Idempotent (retélécharge,
 * remplace, réuploade). Retourne le nombre de placeholders remplacés.
 */
async function replaceArticlePlaceholders(
  courseId: string,
  sectionId: unknown,
  captions: string[],
  screenshotKeys: string[],
): Promise<number> {
  if (screenshotKeys.length === 0) return 0;

  const article = await Lesson.findOne({ courseId, sectionId, type: 'article' });
  if (!article?.assets?.articleMd) return 0;

  const section = await Section.findById(sectionId);
  if (!section) return 0;
  const articleKey = storageKeys.course(courseId).lesson(section.order, article.order).article();

  let markdown: string;
  try {
    markdown = (await streamToBuffer(await getObjectStream(articleKey))).toString('utf8');
  } catch (err) {
    logger.warn({ courseId, articleKey, err }, 'article introuvable pour substitution des captures');
    return 0;
  }

  const placeholders = extractScreenshotPlaceholders(markdown);
  if (placeholders.length === 0) return 0;

  let index = 0;
  let replaced = 0;
  const next = markdown.replace(/\{\{screenshot:([^}]+)\}\}/g, (match, desc: string) => {
    const key = screenshotKeys[index];
    if (!key) return match; // plus de capture disponible : on garde le placeholder.
    const alt = (captions[index] ?? desc.trim()).replace(/[[\]()]/g, '');
    // Chemin relatif d'asset dans le paquet exporté (résolu au packaging P24+).
    const rel = key.startsWith(`${storageKeys.course(courseId).prefix}/`)
      ? key.slice(storageKeys.course(courseId).prefix.length + 1)
      : key;
    index += 1;
    replaced += 1;
    return `![${alt}](./${rel})`;
  });

  if (replaced > 0 && next !== markdown) {
    await uploadObject(articleKey, next, 'text/markdown; charset=utf-8');
    article.assets.screenshots = screenshotKeys.slice(0, replaced);
    await article.save();
  }
  return replaced;
}

/** Processor de la queue screenshot-capture (un job = une leçon TP). */
export async function processScreenshotCapture(
  job: Job<ScreenshotJobData>,
): Promise<ScreenshotCaptureResult> {
  const { courseId, lessonId } = job.data;

  const lesson = await Lesson.findById(lessonId);
  if (!lesson) throw new Error(`leçon introuvable : ${lessonId}`);

  // Seules les leçons TP portent des specs de capture ; sinon on sort proprement.
  const parsed = tpSchema.safeParse(lesson.script);
  if (lesson.type !== 'tp' || !parsed.success) {
    await report(courseId, 100, `Aucune capture à produire pour « ${lesson.title} » (leçon non-TP ou script absent)`);
    return { courseId, lessonId, captured: 0, failed: 0, placeholdersReplaced: 0 };
  }

  const section = await Section.findById(lesson.sectionId);
  if (!section) throw new Error(`section introuvable : ${String(lesson.sectionId)}`);
  const keys = storageKeys.course(courseId).lesson(section.order, lesson.order);

  const specs = stepsWithSpec(parsed.data);
  if (specs.length === 0) {
    await report(courseId, 100, `TP « ${lesson.title} » sans étape à illustrer`);
    return { courseId, lessonId, captured: 0, failed: 0, placeholdersReplaced: 0 };
  }

  await report(courseId, 5, `Capture d'écran : ${specs.length} étape(s) à illustrer pour « ${lesson.title} »`);

  const browser = await launchCaptureBrowser();
  const uploadedKeys: string[] = [];
  const captions: string[] = [];
  let failed = 0;

  try {
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i]!;
      const stepNumber = i + 1;
      try {
        const captured = await captureFromSpec(browser, spec);
        const annotated = await composeAnnotated(captured, buildAnnotationSpec(captured, spec, stepNumber));
        const key = keys.screenshot(i);
        await uploadObject(key, annotated, 'image/png');
        uploadedKeys.push(key);
        captions.push(spec.caption);
        await report(
          courseId,
          Math.round(5 + ((i + 1) / specs.length) * 80),
          `Capture ${stepNumber}/${specs.length} produite : ${spec.caption}`,
        );
      } catch (err) {
        failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ courseId, lessonId, step: stepNumber, err }, 'capture en échec (non bloquante)');
        await report(
          courseId,
          Math.round(5 + ((i + 1) / specs.length) * 80),
          `Capture ${stepNumber}/${specs.length} échouée : ${message}`,
          'warn',
        );
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  // Persiste les captures produites sur la leçon TP elle-même.
  lesson.assets.screenshots = uploadedKeys;
  await lesson.save();

  // Reporte les captures dans l'article de la leçon liée (même section).
  let placeholdersReplaced = 0;
  try {
    placeholdersReplaced = await replaceArticlePlaceholders(courseId, lesson.sectionId, captions, uploadedKeys);
  } catch (err) {
    logger.warn({ courseId, lessonId, err }, 'substitution des placeholders article impossible');
  }

  await report(
    courseId,
    100,
    `Captures terminées : ${uploadedKeys.length} produite(s), ${failed} en échec, ${placeholdersReplaced} placeholder(s) d'article remplacé(s)`,
    failed > 0 ? 'warn' : 'info',
  );

  return {
    courseId,
    lessonId,
    captured: uploadedKeys.length,
    failed,
    placeholdersReplaced,
  };
}
