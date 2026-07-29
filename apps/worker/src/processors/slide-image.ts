// Processor de la queue auxiliaire « slide-image » (Lot 3, plan 2026-07-20) :
// régénère à la demande l'illustration SDXL d'UNE slide (bouton « Régénérer »
// de l'éditeur de script). Toujours FORCE une génération fraîche (contrairement
// à `loadOrGenerateSlideIllustration` du rendu normal, qui sert le cache S3 si
// présent) — l'auteur a explicitement demandé une nouvelle image, pas de servir
// l'ancienne. N'ENFILE PAS de re-render vidéo : appliquer la nouvelle image à
// la vidéo est une action DISTINCTE (regenerate render-only), pour que l'auteur
// puisse ajuster plusieurs slides avant de payer un seul re-render complet.
import type { Job } from 'bullmq';
import { Course, Lesson, SLIDE_IMAGE, Section, slideScriptSchema, storageKeys, uploadObject, type SlideScript } from '../shared.js';
import { logger } from '../queues/index.js';
import { generateImageWithEngine, isAnyImageEngineConfigured, type ImageEngine } from '../media/image-generation.js';
import { recordImageCost } from '../lib/cost.js';

export interface SlideImageJobData {
  courseId: string;
  lessonId: string;
  index: number;
  /** Prompt fourni par l'auteur — sinon dérivé du titre/puces de la slide. */
  prompt?: string;
  /**
   * Moteur cible (bouton « essayer l'autre moteur », audit qualité modèles
   * 2026-07-22, additif) : force CE moteur pour cette régénération et le
   * persiste sur la slide (`slide.imageEngine`). Absent = moteur courant de la
   * slide, sinon celui du cours (comportement inchangé).
   */
  targetEngine?: ImageEngine;
}

export interface SlideImageResult {
  courseId: string;
  lessonId: string;
  index: number;
  /** Clé S3 de l'image intégrée — absente si l'image a été rejetée à la vérification. */
  imageKey?: string;
}

/** Nom de la queue BullMQ — miroir de apps/web/src/lib/queues.ts (SLIDE_IMAGE_QUEUE). */
export const SLIDE_IMAGE_QUEUE = 'slide-image';
/** Nom du job — miroir de apps/web/src/lib/queues.ts (SLIDE_IMAGE_JOB). */
export const SLIDE_IMAGE_JOB = 'slide-image-regenerate';

/** jobId déterministe par (leçon × index) : deux slides de la même leçon peuvent régénérer en parallèle sans collision. */
export function slideImageJobId(lessonId: string, index: number): string {
  return `${SLIDE_IMAGE_JOB}_${lessonId}_${index}`;
}

const DEFAULT_NEGATIVE_PROMPT =
  'text, words, letters, captions, watermark, logo, blurry, distorted, low quality';

/** Prompt par défaut dérivé du contenu de la slide, si l'auteur n'en fournit pas. */
function defaultSlideImagePrompt(title: string, bullets: readonly string[], courseTitle: string): string {
  const topic = [title, ...bullets.slice(0, 3)].filter((s) => s.trim()).join(', ');
  return (
    `Modern flat vector illustration for an online course slide about: ${topic || title}. ` +
    `Course topic: ${courseTitle}. Dark background, violet and gold accents, ` +
    `clean professional tech aesthetic, subtle depth, high detail, no text, no words, no letters.`
  );
}

/** Seed déterministe par slide — identique à celui de media/slide-renderer.ts (même image si aucun prompt/seed n'a changé). */
function slideImageSeed(lessonId: string, index: number): number {
  const hex = lessonId.replace(/[^0-9a-f]/gi, '').slice(-7) || '1';
  return (parseInt(hex, 16) + index * 7919) % 2_000_000_000;
}

/** Persiste un échec (best-effort — ne jette jamais, appelé depuis un catch). */
async function markFailed(lessonId: string, index: number): Promise<void> {
  try {
    const lesson = await Lesson.findById(lessonId);
    if (!lesson) return;
    const parsed = slideScriptSchema.safeParse(lesson.script);
    if (!parsed.success) return;
    const slide = parsed.data.slides[index];
    if (!slide) return;
    slide.imageStatus = 'failed';
    lesson.script = parsed.data;
    lesson.markModified('script');
    await lesson.save();
  } catch (err) {
    logger.warn({ lessonId, index, err }, 'slide-image : impossible de persister le statut d’échec');
  }
}

/** Processor de la queue « slide-image » (un job = une slide d'une leçon). */
export async function processSlideImage(job: Job<SlideImageJobData>): Promise<SlideImageResult> {
  const { courseId, lessonId, index, prompt: promptOverride, targetEngine } = job.data;

  const lesson = await Lesson.findById(lessonId);
  if (!lesson) throw new Error(`leçon introuvable : ${lessonId}`);
  if (lesson.type !== 'video') {
    throw new Error(`slide-image : leçon ${lessonId} de type « ${lesson.type} » (attendu : video)`);
  }

  const parsed = slideScriptSchema.safeParse(lesson.script);
  if (!parsed.success) throw new Error(`script vidéo absent ou invalide pour la leçon ${lessonId}`);
  const script: SlideScript = parsed.data;
  const slide = script.slides[index];
  if (!slide) throw new Error(`slide-image : index ${index} hors bornes pour la leçon ${lessonId}`);

  if (!isAnyImageEngineConfigured()) {
    await markFailed(lessonId, index);
    throw new Error('génération d’image non configurée (MODAL_IMAGE / MODAL_ZIMAGE)');
  }

  try {
    const course = await Course.findById(courseId).select('title imageEngine');
    if (!course) throw new Error(`cours introuvable : ${courseId}`);
    const section = await Section.findById(lesson.sectionId).select('order').lean();
    if (!section) throw new Error(`section introuvable pour la leçon ${lessonId}`);

    const key = storageKeys.course(courseId).lesson(section.order, lesson.order).slideIllustration(index);
    const prompt =
      promptOverride?.trim() ||
      slide.imagePrompt?.trim() ||
      defaultSlideImagePrompt(slide.title, slide.bullets, course.title);
    const seed = slide.imageSeed ?? slideImageSeed(lessonId, index);
    // Moteur EFFECTIF de cette génération : targetEngine (bouton switch) en
    // priorité, sinon le moteur ACTUEL de la slide, sinon celui du cours —
    // absent de tout ⇒ SDXL (comportement inchangé).
    const engine: ImageEngine | undefined = targetEngine ?? slide.imageEngine ?? course.imageEngine;

    const { png, provider, validation, durationMs } = await generateImageWithEngine(
      {
        prompt,
        negativePrompt: DEFAULT_NEGATIVE_PROMPT,
        width: SLIDE_IMAGE.WIDTH,
        height: SLIDE_IMAGE.HEIGHT,
        steps: SLIDE_IMAGE.STEPS,
        seed,
      },
      engine,
    );
    // Vérification AVANT intégration (2026-07-26) : une image invalide (vide,
    // corrompue, quasi-unie) même après repli SDXL ne doit PAS être intégrée —
    // on échoue la régénération (la slide garde son motif géométrique) plutôt
    // que d'afficher une illustration cassée dans la vidéo.
    if (!validation.ok) {
      logger.warn(
        { courseId, lessonId, index, reason: validation.reason, provider },
        'slide-image : image rejetée à la vérification — intégration annulée',
      );
      await markFailed(lessonId, index);
      return { courseId, lessonId, index };
    }
    await uploadObject(key, png, 'image/png');
    // Coût image instrumenté avec le moteur réel (audit coûts 2026-07-26).
    await recordImageCost({ courseId }, 1, provider, durationMs).catch(() => undefined);

    slide.imageKey = key;
    slide.imageSource = 'generated';
    slide.imageStatus = 'ready';
    // Le moteur EFFECTIVEMENT utilisé (peut différer de `targetEngine` si un
    // repli a eu lieu — voir generateImageWithEngine) devient le moteur
    // courant de la slide, base des futures régénérations « Régénérer ».
    slide.imageEngine = provider;
    // Un prompt EXPLICITEMENT fourni est persisté (l'auteur le reverra/pourra
    // l'affiner) ; un prompt dérivé par défaut n'est PAS écrit sur la slide —
    // le rendu normal (slide-renderer.ts) le re-dérivera identiquement si le
    // champ reste vide, pas besoin de le figer.
    if (promptOverride?.trim()) slide.imagePrompt = promptOverride.trim();
    script.slides[index] = slide;
    lesson.script = script;
    lesson.markModified('script');
    await lesson.save();

    logger.info({ courseId, lessonId, index, key, provider }, 'slide-image : image régénérée et persistée');
    return { courseId, lessonId, index, imageKey: key };
  } catch (err) {
    logger.error({ courseId, lessonId, index, err }, 'échec de la régénération d’image de slide');
    await markFailed(lessonId, index);
    throw err;
  }
}
