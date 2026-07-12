import { z } from 'zod';
import type { Locale, SlideScript, TpContent } from '@sallycourse/shared';
import { getConfig } from '@sallycourse/shared';
import { logger } from './logger';

/**
 * Assistant de cours (Prompt 146) — chatbot par cours sur le LMS interne.
 * RAG simple et LOCAL, même approche que worker/lib/course-chatbot.ts (source
 * de vérité du module, testé côté worker) : pas d'API d'embeddings payante,
 * recherche par recouvrement de mots-clés significatifs sur le contenu déjà
 * généré pour ne fournir à Claude QUE les passages pertinents. Réimplémenté
 * ici en pur (sans @anthropic-ai/sdk) car apps/web appelle Claude par fetch
 * direct — même pattern que lib/exercise-generator.ts (P145).
 */

/** Bornes de la recherche de passages et du contexte fourni au LLM. */
export const COURSE_CHATBOT = {
  TOP_K: 3,
  MAX_PASSAGE_CHARS: 1200,
  /** Score de recouvrement mots-clés minimal pour qu'une leçon soit considérée pertinente. */
  MIN_RELEVANCE_SCORE: 0.08,
} as const;

/** Mots vides français ignorés dans le recouvrement mots-clés (bruit, aucune valeur discriminante). */
const STOPWORDS = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'et', 'ou', 'est', 'sont',
  'ce', 'cette', 'ces', 'que', 'qui', 'quoi', 'comment', 'pourquoi', 'quand',
  'dans', 'sur', 'pour', 'avec', 'sans', 'par', 'au', 'aux', 'en', 'à', 'a',
  'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles', 'je', 'tu', 'se', 'sa',
  'son', 'ses', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'leur', 'leurs',
  'ne', 'pas', 'plus', 'être', 'avoir', 'fait', 'faire', 'donc', 'mais',
]);

/** Normalise un texte en mots significatifs (minuscules, accents/ponctuation retirés, mots vides exclus). */
function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * Score de pertinence 0-1 entre une question courte et un passage long —
 * recouvrement asymétrique des mots-clés significatifs de la question
 * retrouvés dans le passage. Aligné sur worker/lib/course-chatbot.ts.
 */
export function keywordRelevanceScore(question: string, passage: string): number {
  const queryWords = new Set(significantWords(question));
  if (queryWords.size === 0) return 0;
  const passageWords = new Set(significantWords(passage));
  if (passageWords.size === 0) return 0;
  let hits = 0;
  for (const w of queryWords) if (passageWords.has(w)) hits++;
  return hits / queryWords.size;
}

/** Une leçon candidate minimale — sous-ensemble du document Mongo (lean). */
export interface ChatbotLessonInput {
  id: string;
  title: string;
  type: string;
  summary?: string;
  script?: unknown;
  assets?: { articleMd?: string };
}

export interface RelevantPassage {
  lessonId: string;
  lessonTitle: string;
  excerpt: string;
  score: number;
}

/** Extrait le texte réellement généré d'une leçon — aligné sur extractComparableLessonText. */
export function extractComparableLessonText(lesson: ChatbotLessonInput): string {
  if (lesson.type === 'video' && lesson.script) {
    const script = lesson.script as Partial<SlideScript>;
    const narrations = (script.slides ?? [])
      .map((s) => s?.narration ?? '')
      .filter(Boolean)
      .join(' ');
    if (narrations) return narrations;
  }
  if (lesson.type === 'tp' && lesson.script) {
    const tp = lesson.script as Partial<TpContent>;
    const parts = [tp.objective ?? '', ...(tp.steps ?? []).map((s) => s?.instruction ?? '')];
    const joined = parts.filter(Boolean).join(' ');
    if (joined) return joined;
  }
  if (lesson.type === 'article' && lesson.assets?.articleMd) {
    return lesson.assets.articleMd;
  }
  return lesson.summary ?? lesson.title;
}

/** Tronque un passage à une taille raisonnable, en coupant sur une frontière de mot. */
function truncatePassage(text: string, maxChars: number = COURSE_CHATBOT.MAX_PASSAGE_CHARS): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut}…`;
}

/**
 * Recherche les passages les plus pertinents pour `question` parmi les
 * leçons du cours (recherche mots-clés locale, PURE). Retourne au plus
 * COURSE_CHATBOT.TOP_K passages triés par pertinence décroissante.
 */
export function findRelevantPassages(
  question: string,
  lessons: readonly ChatbotLessonInput[],
): RelevantPassage[] {
  const scored = lessons
    .map((lesson) => {
      const text = extractComparableLessonText(lesson);
      return {
        lessonId: lesson.id,
        lessonTitle: lesson.title,
        excerpt: truncatePassage(text),
        score: keywordRelevanceScore(question, `${lesson.title} ${text}`),
      };
    })
    .filter((entry) => entry.score >= COURSE_CHATBOT.MIN_RELEVANCE_SCORE && entry.excerpt.trim().length > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, COURSE_CHATBOT.TOP_K);
}

/** Schéma de la réponse attendue du LLM — réponse sourcée. */
export const courseChatbotAnswerSchema = z.object({
  answer: z.string().min(1),
  sourceLessonIds: z.array(z.string()).default([]),
});
export type CourseChatbotAnswer = z.infer<typeof courseChatbotAnswerSchema>;

const LOCALE_LABELS: Record<Locale, string> = { fr: 'français', en: 'anglais', ar: 'arabe' };

/** Prompt système : ton tuteur, contrainte de fidélité au contexte fourni. */
export function courseChatbotSystemPrompt(locale: Locale): string {
  return [
    `Tu es l'assistant pédagogique d'un cours en ligne. Un étudiant pose une question`,
    `pendant son apprentissage. Tu reçois des EXTRAITS du contenu réel du cours (narration`,
    `vidéo, article, énoncé de TP) — réponds UNIQUEMENT à partir de ces extraits.`,
    ``,
    `RÈGLES IMPÉRATIVES :`,
    `1. Si la réponse se trouve dans les extraits fournis, réponds clairement et cite les`,
    `   leçons sources (sourceLessonIds) dont le contenu t'a permis de répondre.`,
    `2. Si les extraits ne permettent PAS de répondre, dis-le honnêtement plutôt que`,
    `   d'inventer — propose à l'étudiant de consulter une autre leçon ou de reformuler.`,
    `3. Ne réponds jamais hors du périmètre du cours (pas de sujet général non couvert).`,
    `4. Langue de la réponse : ${LOCALE_LABELS[locale]}.`,
    ``,
    `FORMAT DE SORTIE — réponds UNIQUEMENT avec ce JSON (aucun texte autour, aucune fence) :`,
    `{ "answer": string, "sourceLessonIds": string[] }`,
  ].join('\n');
}

/** Prompt utilisateur : question + passages pertinents en contexte. */
export function courseChatbotUserPrompt(question: string, passages: readonly RelevantPassage[]): string {
  const lines = [`Question de l'étudiant : ${question}`, ``];
  if (passages.length === 0) {
    lines.push(`Aucun extrait pertinent n'a été trouvé dans le contenu du cours pour cette question.`);
  } else {
    lines.push(`Extraits du contenu du cours (les plus pertinents pour cette question) :`);
    for (const passage of passages) {
      lines.push(``, `--- Leçon [id=${passage.lessonId}] « ${passage.lessonTitle} » ---`, passage.excerpt);
    }
  }
  return lines.join('\n');
}

interface AnthropicMessageResponse {
  content: { type: string; text?: string }[];
}

/** Extrait le premier bloc JSON (objet) d'une réponse texte. */
function extractJsonObjectPayload(raw: string): string {
  const trimmed = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fence?.[1]) return fence[1].trim();
  if (trimmed.startsWith('{')) return trimmed;
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) return trimmed.slice(firstBrace, lastBrace + 1);
  return trimmed;
}

/** Fixture déterministe (mode mock) — pas d'appel réseau. */
function mockAnswer(question: string, passages: readonly RelevantPassage[]): CourseChatbotAnswer {
  if (passages.length === 0) {
    return {
      answer: `[Réponse simulée] Je ne trouve pas d'extrait du cours répondant précisément à « ${question} ». Essayez de reformuler ou consultez une autre leçon.`,
      sourceLessonIds: [],
    };
  }
  return {
    answer: `[Réponse simulée — MOCK_PROVIDERS actif ou clé Anthropic absente] D'après « ${passages[0]!.lessonTitle} », voici des éléments de réponse à « ${question} ».`,
    sourceLessonIds: passages.map((p) => p.lessonId),
  };
}

export interface AnswerCourseQuestionInput {
  question: string;
  lessons: readonly ChatbotLessonInput[];
  locale?: Locale;
}

/**
 * Point d'entrée du chatbot côté web : trouve les passages pertinents puis
 * appelle Claude (fetch direct, mock-friendly) pour une réponse sourcée.
 */
export async function answerCourseQuestion(input: AnswerCourseQuestionInput): Promise<CourseChatbotAnswer> {
  const { question, lessons, locale = 'fr' } = input;
  const passages = findRelevantPassages(question, lessons);
  const config = getConfig();

  if (config.MOCK_PROVIDERS || !config.ANTHROPIC_API_KEY) {
    return mockAnswer(question, passages);
  }

  const system = courseChatbotSystemPrompt(locale);
  const user = courseChatbotUserPrompt(question, passages);
  const baseURL = process.env.ANTHROPIC_BASE_URL?.trim() || 'https://api.anthropic.com';

  const response = await fetch(`${baseURL}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 2048,
      system,
      messages: [{ role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    logger.warn({ status: response.status }, 'answerCourseQuestion : appel Claude en échec');
    throw new Error(`Échec de l'appel Claude (HTTP ${response.status}).`);
  }

  const data = (await response.json()) as AnthropicMessageResponse;
  const text = data.content
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text)
    .join('\n');

  const parsed = courseChatbotAnswerSchema.safeParse(JSON.parse(extractJsonObjectPayload(text)));
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, 'answerCourseQuestion : JSON invalide');
    throw new Error('Réponse du chatbot non conforme au format attendu.');
  }
  return parsed.data;
}
