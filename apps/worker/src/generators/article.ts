// Générateur d'articles (Prompt 16) : pour une leçon de type 'article',
// appelle Claude avec articleContentSchema (fixture locale si MOCK_PROVIDERS),
// vérifie les règles rédactionnelles (800-1500 mots, H2/H3, encadrés
// « À retenir », placeholders {{screenshot:…}}) avec retry + feedback, uploade
// le Markdown dans le stockage objet puis persiste Lesson.assets.articleMd + status.
import { createHash } from 'node:crypto';
import {
  ARTICLE,
  Course,
  Lesson,
  Section,
  articleContentSchema,
  extractScreenshotPlaceholders,
  storageKeys,
  uploadObject,
  type ArticleContent,
  type Difficulty,
  type Locale,
} from '../shared.js';
import { callClaudeJson } from '../lib/claude.js';
import { logger } from '../queues/index.js';
import { articleSystemPrompt, articleUserPrompt } from '../prompts/article.js';

/** Tentatives quand les règles rédactionnelles échouent (le schéma est garanti par callClaudeJson). */
const MAX_BUSINESS_ATTEMPTS = 3;
/** Un article de 1500 mots + blocs de code tient largement dans ce budget de sortie. */
const ARTICLE_MAX_TOKENS = 8192;

export interface ArticleResult {
  lessonId: string;
  /** Clé S3 du Markdown (également posée dans Lesson.assets.articleMd). */
  storageKey: string;
  words: number;
  /** Règles rédactionnelles restées insatisfaites (article accepté avec warn). */
  violations: string[];
}

/** Compte les mots du Markdown, blocs de code fencés exclus. */
export function countArticleWords(markdown: string): number {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * Règles rédactionnelles au-delà du schéma Zod : longueur, sections H2,
 * encadré « À retenir » (blockquote), placeholders de captures. Retourne la
 * liste des problèmes (vide = conforme) — réinjectée au LLM en cas d'échec.
 */
export function validateArticleBusiness(article: ArticleContent): string[] {
  const problems: string[] = [];
  const { markdown } = article;

  const words = countArticleWords(markdown);
  if (words < ARTICLE.MIN_WORDS) {
    problems.push(`L'article fait ${words} mots (hors code) — il en faut au moins ${ARTICLE.MIN_WORDS}.`);
  } else if (words > ARTICLE.MAX_WORDS) {
    problems.push(`L'article fait ${words} mots (hors code) — il en faut au plus ${ARTICLE.MAX_WORDS}.`);
  }

  const h2Count = (markdown.match(/^##\s+/gm) ?? []).length;
  if (h2Count < ARTICLE.MIN_H2_SECTIONS) {
    problems.push(
      `L'article contient ${h2Count} section(s) H2 (##) — il en faut au moins ${ARTICLE.MIN_H2_SECTIONS}.`,
    );
  }

  if (!/^>\s*\*\*À retenir\*\*/m.test(markdown)) {
    problems.push('Aucun encadré "> **À retenir**" (blockquote) — il en faut au moins un.');
  }

  if (extractScreenshotPlaceholders(markdown).length === 0) {
    problems.push('Aucun placeholder {{screenshot:description précise}} — il en faut au moins un.');
  }

  return problems;
}

export interface ArticleContentInput {
  lessonTitle: string;
  courseTitle: string;
  summary?: string | undefined;
  difficulty: Difficulty;
  locale: Locale;
  /** Contexte de continuité (résumés des leçons précédentes, P19). */
  context?: string | undefined;
}

/**
 * Cœur pur (testable sans Mongo ni S3) : prompt → Claude → règles
 * rédactionnelles avec retry + feedback. Les règles sont SOUPLES : après
 * MAX_BUSINESS_ATTEMPTS le dernier candidat (toujours conforme au schéma) est
 * accepté avec un warn — indispensable en mode mock où la fixture,
 * déterministe et courte, ne peut pas converger vers 800 mots.
 */
export async function generateArticleContent(
  input: ArticleContentInput,
): Promise<{ article: ArticleContent; violations: string[] }> {
  const system = articleSystemPrompt();
  const baseUser = articleUserPrompt(input);

  let article: ArticleContent | null = null;
  let violations: string[] = [];

  for (let attempt = 1; attempt <= MAX_BUSINESS_ATTEMPTS; attempt++) {
    const user =
      violations.length === 0
        ? baseUser
        : `${baseUser}\n\nTa précédente proposition violait ces règles — corrige-les impérativement :\n${violations
            .map((p) => `- ${p}`)
            .join('\n')}`;

    article = await callClaudeJson({
      schema: articleContentSchema,
      system,
      user,
      maxTokens: ARTICLE_MAX_TOKENS,
    });

    violations = validateArticleBusiness(article);
    if (violations.length === 0) break;
    logger.warn(
      { lessonTitle: input.lessonTitle, attempt, problems: violations },
      'article non conforme aux règles rédactionnelles',
    );
  }

  // Garde théorique : la boucle affecte toujours article avant de sortir.
  if (!article) throw new Error(`génération d'article sans candidat pour « ${input.lessonTitle} »`);
  if (violations.length > 0) {
    logger.warn(
      { lessonTitle: input.lessonTitle, problems: violations },
      `article accepté malgré ${violations.length} règle(s) rédactionnelle(s) insatisfaite(s)`,
    );
  }
  return { article, violations };
}

/**
 * Génère l'article d'une leçon et le persiste : Markdown uploadé sous
 * storageKeys…article(), clé posée dans Lesson.assets.articleMd, contentHash
 * SHA-256 et status 'ready'. Jette en cas d'échec (le dispatcher
 * content-generation gère alors le statut 'failed').
 */
export async function generateArticle(params: {
  courseId: string;
  lessonId: string;
  /** Contexte de continuité (résumés des leçons précédentes, P19). */
  context?: string;
}): Promise<ArticleResult> {
  const { courseId, lessonId, context } = params;

  const lesson = await Lesson.findById(lessonId);
  if (!lesson) throw new Error(`leçon introuvable : ${lessonId}`);
  if (lesson.type !== 'article') {
    throw new Error(`generateArticle : leçon ${lessonId} de type « ${lesson.type} » (attendu : article)`);
  }
  const [course, section] = await Promise.all([
    Course.findById(courseId),
    Section.findById(lesson.sectionId),
  ]);
  if (!course) throw new Error(`cours introuvable : ${courseId}`);
  if (!section) throw new Error(`section introuvable : ${String(lesson.sectionId)}`);

  const { article, violations } = await generateArticleContent({
    lessonTitle: lesson.title,
    courseTitle: course.title,
    summary: lesson.summary,
    difficulty: course.difficulty,
    locale: course.locale,
    context,
  });

  // Clé déterministe par position (section, leçon) : un retry écrase l'ancien objet.
  const storageKey = storageKeys.course(courseId).lesson(section.order, lesson.order).article();
  await uploadObject(storageKey, article.markdown, 'text/markdown; charset=utf-8');

  lesson.assets.articleMd = storageKey;
  lesson.contentHash = createHash('sha256').update(article.markdown).digest('hex');
  lesson.status = 'ready';
  await lesson.save();

  const result: ArticleResult = {
    lessonId,
    storageKey,
    words: countArticleWords(article.markdown),
    violations,
  };
  logger.info({ courseId, ...result, violations: result.violations.length }, 'article généré et persisté');
  return result;
}
