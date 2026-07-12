// Assistant de cours (Prompt 146) : chatbot par cours pour l'étudiant du LMS
// interne. Approche RAG SIMPLE et LOCALE — pas d'API d'embeddings payante :
// on découpe le contenu déjà généré (narration vidéo, énoncé de TP, article
// Markdown) en PASSAGES, on les classe par pertinence vis-à-vis de la question
// via un recouvrement de MOTS-CLÉS significatifs (hors mots vides français),
// puis on ne fournit à Claude QUE les 2-3 passages les plus pertinents comme
// contexte. Note : distinct de compareSimilarity (content-similarity.ts,
// P115, n-grams de 4 mots CONSÉCUTIFS) — ce dernier sert à détecter des
// PARAPHRASES entre deux textes LONGS de même nature, alors qu'ici on compare
// une question COURTE à un passage long : un recouvrement de mots individuels
// (indépendants de l'ordre) est le bon niveau de granularité pour ce cas.
// Le prompt exige une réponse sourcée (sourceLessonIds) pour que l'étudiant
// puisse retrouver la leçon d'origine plutôt que de faire confiance aveugle.
import { z } from 'zod';
import { callClaudeJson } from './claude.js';
import { extractComparableLessonText } from './content-similarity.js';
// @ts-ignore TS6059 — source hors rootDir (voir shared.ts), typage intact
import { type ILesson, type Locale } from '../shared.js';

/** Bornes de la recherche de passages et du contexte fourni au LLM. */
export const COURSE_CHATBOT = {
  /** Nombre de leçons les plus pertinentes retenues comme contexte. */
  TOP_K: 3,
  /** Taille max (caractères) d'un passage inclus dans le prompt — évite un contexte démesuré. */
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
 * Score de pertinence 0-1 entre une question courte et un passage long : part
 * des mots-clés significatifs de la QUESTION qu'on retrouve dans le passage
 * (recouvrement asymétrique — le passage est bien plus long, un Jaccard
 * classique écraserait toujours le score). PURE, déterministe, local.
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

/** Une leçon candidate pour la recherche de passages (contenu réellement généré). */
export interface ChatbotLessonInput {
  id: string;
  title: string;
  type: ILesson['type'];
  summary?: string;
  script?: unknown;
  assets?: ILesson['assets'];
}

/** Passage retenu après recherche, avec son score de pertinence. */
export interface RelevantPassage {
  lessonId: string;
  lessonTitle: string;
  /** Texte tronqué à COURSE_CHATBOT.MAX_PASSAGE_CHARS, réellement généré (pas juste le résumé). */
  excerpt: string;
  score: number;
}

/**
 * Découpe/tronque le texte comparable d'une leçon à une taille raisonnable
 * pour un prompt (MAX_PASSAGE_CHARS). Coupe sur une frontière de mot pour
 * rester lisible. PURE.
 */
function truncatePassage(text: string, maxChars: number = COURSE_CHATBOT.MAX_PASSAGE_CHARS): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut}…`;
}

/**
 * Recherche les passages les plus pertinents pour `question` parmi les
 * leçons du cours, via un recouvrement de mots-clés significatifs
 * (keywordRelevanceScore) entre la question et le texte réellement généré de
 * chaque leçon (titre inclus, pour matcher les questions qui nomment
 * directement une leçon) — approximation locale gratuite d'une recherche
 * sémantique. PURE, ne touche jamais la base ; retourne au plus
 * COURSE_CHATBOT.TOP_K passages, triés du plus pertinent au moins pertinent,
 * en écartant les scores trop faibles (bruit, aucun recouvrement significatif).
 */
export function findRelevantPassages(
  question: string,
  lessons: readonly ChatbotLessonInput[],
): RelevantPassage[] {
  const scored = lessons
    .map((lesson) => {
      const text = extractComparableLessonText(lesson as Pick<ILesson, 'type' | 'title' | 'summary' | 'script' | 'assets'>);
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

/** Schéma de la réponse attendue du LLM — réponse sourcée, jamais inventée sans base. */
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

/** Prompt utilisateur : question + passages pertinents en contexte, identifiés par lessonId. */
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

export interface AnswerCourseQuestionInput {
  question: string;
  lessons: readonly ChatbotLessonInput[];
  locale?: Locale;
}

/**
 * Point d'entrée du chatbot : trouve les passages pertinents (recherche
 * mots-clés locale) puis appelle Claude pour une réponse sourcée. Si aucun
 * passage pertinent n'est trouvé, on appelle quand même Claude (avec un
 * contexte vide explicite) pour qu'il réponde honnêtement plutôt que de
 * planter — cf. règle 2 du prompt système.
 */
export async function answerCourseQuestion(input: AnswerCourseQuestionInput): Promise<CourseChatbotAnswer> {
  const { question, lessons, locale = 'fr' } = input;
  const passages = findRelevantPassages(question, lessons);

  return callClaudeJson<CourseChatbotAnswer>({
    schema: courseChatbotAnswerSchema,
    system: courseChatbotSystemPrompt(locale),
    user: courseChatbotUserPrompt(question, passages),
  });
}
