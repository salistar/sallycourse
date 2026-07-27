// Générateur de FLASHCARDS + export Anki (Prompt 203) : en fin de pipeline
// (aux côtés des ressources P65), produit pour un cours un jeu de 30-60
// flashcards (recto = concept/question, verso = réponse concise) à partir du
// plan et des résumés de leçons déjà générés — un seul appel LLM (callClaudeJson,
// mock-friendly). Deux sorties uploadées :
//  - deck.json (affichage web + module de révision espacée),
//  - anki.txt (TSV « recto<TAB>verso » importable directement dans Anki).
// Best-effort : un échec n'invalide jamais la finalisation du cours.
import {
  Course,
  Lesson,
  Section,
  courseFlashcardsSchema,
  storageKeys,
  uploadObject,
  type CourseFlashcards,
} from '../shared.js';
import { callClaudeJson } from '../lib/claude.js';
import type { CostContext } from '../lib/cost.js';
import { logger } from '../queues/index.js';

/**
 * Sérialise les cartes au format TSV Anki (une carte/ligne).
 *
 * Anki parse le texte importé en RFC-4180 (même en TSV) : un champ qui COMMENCE
 * par un guillemet ouvre un champ cité et avale tout jusqu'au guillemet suivant
 * — une carte comme `"Clean code" : que signifie ce terme ?` corrompt alors la
 * carte, voire les suivantes. On échappe donc les guillemets à la RFC (doublés,
 * champ cité), comme le fait déjà quizToUdemyCsv. Le préfixe `#` (commentaire
 * Anki) est neutralisé par le même mécanisme. PURE.
 */
export function flashcardsToAnkiTsv(cards: CourseFlashcards['cards']): string {
  const clean = (s: string) => s.replace(/[\t\r\n]+/g, ' ').trim();
  const cell = (s: string) => {
    const v = clean(s);
    return v.includes('"') || v.startsWith('#') ? `"${v.replace(/"/g, '""')}"` : v;
  };
  return [
    '#separator:tab',
    '#html:false',
    ...cards.map((c) => `${cell(c.front)}\t${cell(c.back)}`),
  ].join('\n');
}

/**
 * Génère les flashcards d'un cours + leurs exports (JSON + Anki TSV), pose
 * Course.repurposing.flashcards. Jette en cas d'échec (l'appelant best-effort
 * décide de l'ignorer).
 */
export async function generateCourseFlashcards(
  courseId: string,
  cost?: CostContext,
): Promise<{ count: number }> {
  const course = await Course.findById(courseId);
  if (!course) throw new Error(`cours introuvable : ${courseId}`);

  const lessons = await Lesson.find({ courseId }).select('title summary type sectionId').lean();
  const sections = await Section.find({ courseId }).sort({ order: 1 }).lean();
  const sectionTitle = new Map(sections.map((s) => [String(s._id), s.title]));
  const lessonLines = lessons
    .map((l) => `- (${sectionTitle.get(String(l.sectionId)) ?? '?'}) [${l.type}] ${l.title}${l.summary ? ` : ${l.summary}` : ''}`)
    .join('\n');

  const system =
    `Tu es un expert en pédagogie et en mémorisation (répétition espacée). Tu produis des flashcards de qualité ` +
    `pour réviser un cours : le RECTO est une question ou un concept clé, le VERSO la réponse concise et exacte. ` +
    `Couvre les notions ESSENTIELLES, une notion par carte, sans redite, dans la langue du cours.`;
  const user =
    `Cours : « ${course.title} » (niveau ${course.difficulty}, langue ${course.locale}).\n` +
    `Plan et résumés des leçons :\n${lessonLines}\n\n` +
    `Génère entre 30 et 60 flashcards couvrant les concepts clés. Réponds UNIQUEMENT en JSON : ` +
    `{ "cards": [ { "front": string, "back": string } ] }.`;

  const deck = await callClaudeJson({
    schema: courseFlashcardsSchema,
    system,
    user,
    maxTokens: 8000,
    ...(cost ? { cost } : {}),
    llmProviderId: course.llmProvider,
  });

  const keys = storageKeys.course(courseId);
  await uploadObject(keys.flashcards(), Buffer.from(JSON.stringify(deck, null, 2)), 'application/json');
  await uploadObject(keys.flashcardsAnki(), Buffer.from(flashcardsToAnkiTsv(deck.cards), 'utf8'), 'text/plain; charset=utf-8');
  await Course.updateOne(
    { _id: courseId },
    { $set: { 'repurposing.flashcards': { count: deck.cards.length, jsonKey: keys.flashcards(), ankiKey: keys.flashcardsAnki() } } },
  );

  logger.info({ courseId, count: deck.cards.length }, 'flashcards générées');
  return { count: deck.cards.length };
}

/** Variante best-effort (jamais fatale) pour la finalisation du cours. */
export async function generateCourseFlashcardsBestEffort(courseId: string): Promise<void> {
  try {
    await generateCourseFlashcards(courseId, { courseId });
  } catch (err) {
    logger.warn({ courseId, err }, 'génération flashcards échouée — ignorée (best-effort)');
  }
}
