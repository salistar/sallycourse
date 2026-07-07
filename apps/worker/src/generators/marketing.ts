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

/** Tentatives quand les règles MÉTIER échouent (le schéma est garanti par callClaudeJson). */
const MAX_BUSINESS_ATTEMPTS = 3;
/** Description longue + 5 titres justifiés : budget de sortie large. */
const MARKETING_MAX_TOKENS = 8192;

/** Noms de fichiers des visuels dans le bucket (sous storageKeys…marketing()). */
export const MARKETING_ASSET_FILES = {
  udemyCover: 'cover-udemy.png',
  youtubeThumbnail: 'thumbnail-youtube.png',
} as const;

/** Badge affiché sur les visuels selon le niveau du cours. */
const BADGE_LABELS: Record<Difficulty, string> = {
  beginner: 'Débutant',
  intermediate: 'Intermédiaire',
  advanced: 'Avancé',
};

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

  // ── Persistance sur le cours ────────────────────────────────────
  await Course.updateOne(
    { _id: courseId },
    {
      $set: {
        marketing: {
          status: 'ready',
          content,
          assets: {
            udemyCover: udemyCoverKey,
            youtubeThumbnail: youtubeThumbnailKey,
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
