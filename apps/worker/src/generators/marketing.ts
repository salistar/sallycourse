// Landing marketing du cours (Prompt 28) : textes via Claude (marketingSchema,
// mock-compatible) avec validations métier retry+feedback, visuels SVG du
// design system rendus en PNG par sharp (cover Udemy 750×422, miniature
// YouTube 1280×720), upload S3 sous courses/{id}/marketing/ et persistance
// du tout sur Course.marketing.
import sharp from 'sharp';
import {
  Course,
  UDEMY,
  generateCourseImage,
  marketingSchema,
  storageKeys,
  uploadObject,
  type CourseImageSpecInput,
  type Difficulty,
  type MarketingContent,
  type Outline,
} from '../shared.js';
import { logger } from '../queues/index.js';
import { callClaudeJson } from '../lib/claude.js';
import { recordImageCost } from '../lib/cost.js';
import { marketingSystemPrompt, marketingUserPrompt } from '../prompts/marketing.js';
import { generateImageWithEngine, isAnyImageEngineConfigured } from '../media/image-generation.js';

/** Tentatives quand les règles MÉTIER échouent (le schéma est garanti par callClaudeJson). */
const MAX_BUSINESS_ATTEMPTS = 3;
/** Description longue + 5 titres justifiés : budget de sortie large. */
const MARKETING_MAX_TOKENS = 8192;

/** Noms de fichiers des visuels dans le bucket (sous storageKeys…marketing()). */
export const MARKETING_ASSET_FILES = {
  udemyCover: 'cover-udemy.png',
  youtubeThumbnail: 'thumbnail-youtube.png',
  // Illustration SDXL (Modal) — vraie image, sert de hero (coverImageUrl).
  heroCover: 'cover-hero.png',
} as const;

/** Badge affiché sur les visuels selon le niveau du cours. */
const BADGE_LABELS: Record<Difficulty, string> = {
  beginner: 'Débutant',
  intermediate: 'Intermédiaire',
  advanced: 'Avancé',
};

/** Seed déterministe (même cours → même illustration SDXL) dérivé de l'ObjectId hex. */
function coverSeed(courseId: string): number {
  const hex = courseId.replace(/[^0-9a-f]/gi, '').slice(-7) || '1';
  return parseInt(hex, 16) % 2_000_000_000;
}

/**
 * Prompt SDXL de la cover : sujet du cours + style illustration pro, SANS texte
 * (SDXL ne rend pas de texte lisible → la cover texte-baked SVG reste pour la
 * marketplace). L'anglais donne de meilleurs résultats SDXL ; le titre technique
 * + des mots-clés de style + le niveau suffisent à orienter le visuel.
 */
function buildCoverPrompt(title: string, outline: Outline | undefined, difficulty: Difficulty): string {
  const subtitle = outline?.subtitle?.trim();
  const level =
    difficulty === 'advanced'
      ? 'expert, sophisticated'
      : difficulty === 'beginner'
        ? 'friendly, approachable'
        : 'professional';
  return [
    `Professional online course cover illustration about: ${title}.`,
    subtitle ?? '',
    `Modern flat vector illustration, clean ${level} tech aesthetic, soft gradient background, subtle depth, high detail, no text, no words, no letters.`,
  ]
    .filter(Boolean)
    .join(' ');
}

export interface CourseMarketingResult {
  courseId: string;
  /** Clé S3 de l'image de cours Udemy 750×422. */
  udemyCoverKey: string;
  /** Clé S3 de la miniature YouTube 1280×720. */
  youtubeThumbnailKey: string;
  titleIdeas: number;
  descriptionWords: number;
}

/** Compte les mots d'un texte (séparateurs blancs). */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Validations métier au-delà du schéma Zod : volume SEO de la description,
 * longueur Udemy et unicité des idées de titres. Retourne la liste des
 * problèmes (vide si conforme) — réinjectée au LLM en cas d'échec.
 */
export function validateMarketingBusiness(content: MarketingContent): string[] {
  const problems: string[] = [];

  const words = countWords(content.udemyDescription);
  if (words < UDEMY.DESCRIPTION_MIN_WORDS) {
    problems.push(
      `La description Udemy fait ${words} mots — il en faut au moins ${UDEMY.DESCRIPTION_MIN_WORDS} pour le SEO.`,
    );
  }

  const seen = new Set<string>();
  content.titleIdeas.forEach((idea, index) => {
    const n = index + 1;
    if (idea.title.length > UDEMY.TITLE_MAX_CHARS) {
      problems.push(
        `L'idée de titre ${n} dépasse ${UDEMY.TITLE_MAX_CHARS} caractères (${idea.title.length}) : « ${idea.title} ».`,
      );
    }
    const key = idea.title.trim().toLowerCase();
    if (seen.has(key)) {
      problems.push(`L'idée de titre ${n} est un doublon — les ${content.titleIdeas.length} titres doivent être distincts.`);
    }
    seen.add(key);
  });

  return problems;
}

/** Rend un SVG du design system en PNG (sharp/librsvg — dimensions portées par le SVG). */
async function svgToPng(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Génère la landing marketing complète d'un cours et la persiste :
 * Course.marketing = { status:'ready', content, assets, generatedAt }.
 * Jette en cas d'échec (l'appelant gère le statut du cours).
 */
export async function generateCourseMarketing(params: { courseId: string }): Promise<CourseMarketingResult> {
  const { courseId } = params;

  const course = await Course.findById(courseId);
  if (!course) throw new Error(`cours introuvable : ${courseId}`);
  const outline = (course.outline ?? undefined) as Outline | undefined;

  // ── Textes marketing (LLM ou fixture mock) ─────────────────────
  const system = marketingSystemPrompt();
  const baseUser = marketingUserPrompt({
    courseTitle: course.title,
    subtitle: outline?.subtitle,
    description: outline?.description,
    learningObjectives: outline?.learningObjectives,
    difficulty: course.difficulty,
    locale: course.locale,
  });

  let content: MarketingContent | null = null;
  let feedback: string[] = [];
  for (let attempt = 1; attempt <= MAX_BUSINESS_ATTEMPTS; attempt++) {
    const user =
      feedback.length === 0
        ? baseUser
        : `${baseUser}\n\nTa précédente proposition violait ces règles — corrige-les impérativement :\n${feedback
            .map((p) => `- ${p}`)
            .join('\n')}`;

    const candidate = await callClaudeJson({
      schema: marketingSchema,
      system,
      user,
      maxTokens: MARKETING_MAX_TOKENS,
      // Retry métier (P72) : feedback potentiellement identique d'une tentative
      // à l'autre — désactive le cache pour ne pas rejouer la même réponse.
      skipCache: attempt > 1,
      cost: { courseId, userId: String(course.userId) },
    });

    feedback = validateMarketingBusiness(candidate);
    if (feedback.length === 0) {
      content = candidate;
      break;
    }
    logger.warn({ courseId, attempt, problems: feedback }, 'marketing non conforme aux règles métier');
  }

  if (!content) {
    throw new Error(
      `marketing non conforme après ${MAX_BUSINESS_ATTEMPTS} tentatives :\n${feedback.join('\n')}`,
    );
  }

  // ── Visuels : SVG déterministes du design system → PNG ─────────
  const subtitle = outline?.subtitle?.trim().slice(0, 160) || undefined;
  const baseSpec = {
    title: course.title.trim().slice(0, 200),
    ...(subtitle ? { subtitle } : {}),
    lang: course.locale,
    badge: BADGE_LABELS[course.difficulty as Difficulty],
  } satisfies Omit<CourseImageSpecInput, 'format'>;

  const [udemyPng, youtubePng] = await Promise.all([
    svgToPng(generateCourseImage({ ...baseSpec, format: 'udemy' })),
    svgToPng(generateCourseImage({ ...baseSpec, format: 'youtube' })),
  ]);

  const keys = storageKeys.course(courseId);
  const udemyCoverKey = keys.marketing(MARKETING_ASSET_FILES.udemyCover);
  const youtubeThumbnailKey = keys.marketing(MARKETING_ASSET_FILES.youtubeThumbnail);
  await uploadObject(udemyCoverKey, udemyPng, 'image/png');
  await uploadObject(youtubeThumbnailKey, youtubePng, 'image/png');

  // Coût des 2 visuels marketing générés (P55) — best-effort.
  await recordImageCost({ courseId, userId: String(course.userId) }, 2).catch(() => undefined);

  // ── Cover art RÉELLE via SDXL/Z-Image Turbo (Modal GPU) ─────────
  // Remplace la miniature géométrique par une vraie illustration quand un
  // moteur d'image est activé. Best-effort : tout échec (endpoint froid,
  // quota…) garde la cover SVG. Ni SDXL ni Z-Image Turbo ne rendent de texte,
  // l'illustration sert donc de HERO (course.coverImageUrl) ; la cover SVG
  // texte-baked reste udemyCover pour l'export marketplace.
  let heroCoverKey: string | undefined;
  if (isAnyImageEngineConfigured()) {
    try {
      const { png: heroPng, provider, durationMs } = await generateImageWithEngine(
        {
          prompt: buildCoverPrompt(course.title, outline, course.difficulty as Difficulty),
          negativePrompt:
            'text, words, letters, captions, watermark, logo, blurry, distorted, low quality, extra limbs, deformed',
          width: 1360,
          height: 768,
          steps: 30,
          seed: coverSeed(courseId),
        },
        course.imageEngine,
      );
      heroCoverKey = keys.marketing(MARKETING_ASSET_FILES.heroCover);
      await uploadObject(heroCoverKey, heroPng, 'image/png');
      // Moteur réel dans `model` (audit coûts 2026-07-26) : ventilation par app Modal.
      await recordImageCost({ courseId, userId: String(course.userId) }, 1, provider, durationMs).catch(() => undefined);
      logger.info({ courseId, heroCoverKey, provider }, 'cover générée (hero)');
    } catch (err) {
      logger.warn({ courseId, err }, 'cover indisponible — repli sur la miniature SVG');
      heroCoverKey = undefined;
    }
  }

  // ── Persistance sur le cours ────────────────────────────────────
  await Course.updateOne(
    { _id: courseId },
    {
      $set: {
        // Hero réel SDXL comme cover du cours (sinon on ne touche pas à un
        // coverImageUrl éventuellement déjà présent).
        ...(heroCoverKey ? { coverImageUrl: heroCoverKey } : {}),
        marketing: {
          status: 'ready',
          content,
          assets: {
            udemyCover: udemyCoverKey,
            youtubeThumbnail: youtubeThumbnailKey,
            ...(heroCoverKey ? { heroCover: heroCoverKey } : {}),
          },
          generatedAt: new Date(),
        },
      },
    },
  );

  const result: CourseMarketingResult = {
    courseId,
    udemyCoverKey,
    youtubeThumbnailKey,
    titleIdeas: content.titleIdeas.length,
    descriptionWords: countWords(content.udemyDescription),
  };
  logger.info(result, 'landing marketing générée et persistée');
  return result;
}
