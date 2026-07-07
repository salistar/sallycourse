// Générateur de leçon « quiz » (fin de section) : 8-12 questions QCM via Claude
// (mock-compatible), validations métier avec retry+feedback, persistance dans
// QuizModel, export S3 (quiz.json + Markdown « Quiz + Solutions ») et Lesson.status.
import { z } from 'zod';
import {
  Course,
  Lesson,
  QUIZ,
  Quiz,
  Section,
  quizQuestionSchema,
  storageKeys,
  uploadObject,
  type Outline,
  type QuizQuestion,
} from '../shared.js';
import { logger } from '../queues/index.js';
import { callClaudeJson } from '../lib/claude.js';
import { quizSystemPrompt, quizUserPrompt, type QuizPromptInput } from '../prompts/quiz.js';
import type { CostContext } from '../lib/cost.js';

/** Tentatives quand les règles MÉTIER échouent (le schéma est garanti par callClaudeJson). */
const MAX_BUSINESS_ATTEMPTS = 3;
/** 8-12 questions détaillées avec explications : budget de sortie large. */
const QUIZ_MAX_TOKENS = 8192;
/** En dessous, une explication ne peut ni justifier la bonne réponse ni réfuter les autres. */
const MIN_EXPLANATION_CHARS = 20;

/** Tableau de questions attendu du LLM — bornes Udemy partagées. */
export const quizArraySchema = z
  .array(quizQuestionSchema)
  .min(QUIZ.MIN_QUESTIONS_PER_SECTION)
  .max(QUIZ.MAX_QUESTIONS_PER_SECTION);

export interface QuizGenerationResult {
  lessonId: string;
  questions: number;
  /** Clé S3 du JSON brut des questions. */
  quizKey: string;
  /** Clé S3 du Markdown « Quiz + Solutions ». */
  solutionsKey: string;
}

/**
 * Validations métier au-delà du schéma Zod : mix de difficultés, choix
 * distincts, explications substantielles, pas de question dupliquée.
 * Retourne la liste des problèmes (vide si conforme) — réinjectée au LLM.
 */
export function validateQuizBusiness(questions: readonly QuizQuestion[]): string[] {
  const problems: string[] = [];

  const difficulties = new Set(questions.map((q) => q.difficulty));
  if (difficulties.size < 2) {
    problems.push(
      `Toutes les questions sont de difficulté « ${[...difficulties][0] ?? '?'} » — mélange au moins deux niveaux (beginner/intermediate/advanced).`,
    );
  }

  const seenQuestions = new Set<string>();
  questions.forEach((q, index) => {
    const n = index + 1;
    if (new Set(q.choices.map((c) => c.trim())).size !== q.choices.length) {
      problems.push(
        `Question ${n} : des choix sont identiques — les ${QUIZ.CHOICES_PER_QUESTION} choix doivent être distincts.`,
      );
    }
    if (q.explanation.trim().length < MIN_EXPLANATION_CHARS) {
      problems.push(
        `Question ${n} : explication trop courte — elle doit justifier la bonne réponse ET réfuter chaque distracteur.`,
      );
    }
    const key = q.question.trim().toLowerCase();
    if (seenQuestions.has(key)) {
      problems.push(`Question ${n} : doublon d'une question précédente — chaque question doit être unique.`);
    }
    seenQuestions.add(key);
  });

  return problems;
}

/**
 * Appelle le LLM (ou la fixture mock) et boucle jusqu'à obtenir un quiz
 * conforme aux règles métier, en réinjectant les violations en feedback.
 */
export async function generateQuizQuestions(
  input: QuizPromptInput,
  cost?: CostContext,
): Promise<QuizQuestion[]> {
  const system = quizSystemPrompt();
  const baseUser = quizUserPrompt(input);

  let feedback: string[] = [];
  for (let attempt = 1; attempt <= MAX_BUSINESS_ATTEMPTS; attempt++) {
    const user =
      feedback.length === 0
        ? baseUser
        : `${baseUser}\n\nTa précédente série de questions violait ces règles — corrige-les impérativement :\n${feedback
            .map((p) => `- ${p}`)
            .join('\n')}`;

    // Sortie validée par Zod : les défauts (difficulty) sont appliqués — le
    // type de sortie du schéma est bien QuizQuestion[].
    const candidate = (await callClaudeJson({
      schema: quizArraySchema,
      system,
      user,
      maxTokens: QUIZ_MAX_TOKENS,
      ...(cost ? { cost } : {}),
    })) as QuizQuestion[];

    feedback = validateQuizBusiness(candidate);
    if (feedback.length === 0) return candidate;
    logger.warn(
      { lesson: input.lessonTitle, attempt, problems: feedback },
      'quiz non conforme aux règles métier',
    );
  }

  throw new Error(`quiz non conforme après ${MAX_BUSINESS_ATTEMPTS} tentatives :\n${feedback.join('\n')}`);
}

// Lettres des choix (dérivées de la constante partagée : A, B, C, D).
const CHOICE_LETTERS = Array.from({ length: QUIZ.CHOICES_PER_QUESTION }, (_, i) =>
  String.fromCharCode(65 + i),
);

export interface QuizMarkdownInput {
  courseTitle: string;
  sectionTitle: string;
  lessonTitle: string;
  questions: readonly QuizQuestion[];
}

/**
 * Document Markdown « Quiz + Solutions » : les questions d'abord (imprimables
 * sans les réponses), puis les solutions avec lettre correcte et explication.
 */
export function buildQuizMarkdown(input: QuizMarkdownInput): string {
  const { courseTitle, sectionTitle, lessonTitle, questions } = input;
  const lines: string[] = [
    `# ${lessonTitle}`,
    '',
    `> Cours « ${courseTitle} » — section « ${sectionTitle} » · ${questions.length} questions`,
    '',
    '## Questions',
  ];

  questions.forEach((q, index) => {
    lines.push('', `### Question ${index + 1} (${q.difficulty})`, '', q.question, '');
    q.choices.forEach((choice, c) => {
      lines.push(`- **${CHOICE_LETTERS[c] ?? c + 1}.** ${choice}`);
    });
  });

  lines.push('', '---', '', '## Solutions');
  questions.forEach((q, index) => {
    lines.push(
      '',
      `### Question ${index + 1} — bonne réponse : ${CHOICE_LETTERS[q.correctIndex] ?? q.correctIndex + 1}`,
      '',
      q.explanation,
    );
  });

  return `${lines.join('\n')}\n`;
}

/**
 * Génère le quiz d'une leçon de type « quiz » et le persiste :
 * QuizModel (upsert idempotent), uploads S3 (quiz.json + Markdown solutions),
 * Lesson.assets.articleMd + status 'ready'. Jette en cas d'échec (le
 * dispatcher content-generation gère alors le statut 'failed').
 */
export async function generateQuiz(params: {
  courseId: string;
  lessonId: string;
  /** Contexte de continuité (résumés des leçons précédentes, P19). */
  context?: string;
}): Promise<QuizGenerationResult> {
  const { courseId, lessonId, context } = params;

  const lesson = await Lesson.findById(lessonId);
  if (!lesson) throw new Error(`leçon introuvable : ${lessonId}`);
  if (lesson.type !== 'quiz') {
    throw new Error(`generateQuiz : leçon ${lessonId} de type « ${lesson.type} » (attendu : quiz)`);
  }
  const [course, section] = await Promise.all([
    Course.findById(courseId),
    Section.findById(lesson.sectionId),
  ]);
  if (!course) throw new Error(`cours introuvable : ${courseId}`);
  if (!section) throw new Error(`section introuvable : ${String(lesson.sectionId)}`);

  // Contexte : les leçons de la section (hors quiz) depuis l'outline du cours.
  const outlineSection: Outline['sections'][number] | undefined =
    course.outline?.sections?.[section.order];
  const sectionLessons = outlineSection?.lessons
    .filter((l) => l.type !== 'quiz')
    .map((l) => ({ title: l.title, summary: l.summary }));

  const questions = await generateQuizQuestions(
    {
      courseTitle: course.title,
      sectionTitle: section.title,
      lessonTitle: lesson.title,
      difficulty: course.difficulty,
      locale: course.locale,
      sectionLessons,
      context,
    },
    { courseId, userId: String(course.userId) },
  );

  // Persistance — upsert idempotent : un retry BullMQ remplace les questions.
  await Quiz.findOneAndUpdate(
    { lessonId: lesson._id },
    { $set: { courseId: course._id, sectionId: section._id, questions } },
    { upsert: true },
  );

  // Exports S3 : JSON brut (consommé par le packaging) + Markdown « Quiz + Solutions ».
  const keys = storageKeys.course(courseId).lesson(section.order, lesson.order);
  const quizKey = keys.quiz();
  const solutionsKey = keys.article();
  await uploadObject(quizKey, JSON.stringify(questions, null, 2), 'application/json');
  await uploadObject(
    solutionsKey,
    buildQuizMarkdown({
      courseTitle: course.title,
      sectionTitle: section.title,
      lessonTitle: lesson.title,
      questions,
    }),
    'text/markdown; charset=utf-8',
  );

  lesson.assets.articleMd = solutionsKey;
  lesson.status = 'ready';
  await lesson.save();

  logger.info(
    { courseId, lessonId, questions: questions.length, quizKey, solutionsKey },
    'quiz généré et persisté',
  );
  return { lessonId, questions: questions.length, quizKey, solutionsKey };
}
