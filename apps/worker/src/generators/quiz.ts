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
  renderGenerationDirectives,
  storageKeys,
  uploadObject,
  type Outline,
  type QuizQuestion,
} from '../shared.js';
import { logger } from '../queues/index.js';
import { callClaudeJson } from '../lib/claude.js';
import { checkQuizNoDuplicateCorrectAnswer } from '../lib/llm-output-checks.js';
import { quizSystemPrompt, quizUserPrompt, type QuizPromptInput } from '../prompts/quiz.js';
import type { CostContext } from '../lib/cost.js';

/** Tentatives quand les règles MÉTIER échouent (le schéma est garanti par callClaudeJson). */
const MAX_BUSINESS_ATTEMPTS = 3;
/** 8-12 questions détaillées avec explications : budget de sortie large. */
const QUIZ_MAX_TOKENS = 16384;
/** En dessous, une explication ne peut ni justifier la bonne réponse ni réfuter les autres. */
const MIN_EXPLANATION_CHARS = 20;

/** Tableau de questions attendu du LLM — bornes Udemy partagées. */
export const quizArraySchema = z
  .array(quizQuestionSchema)
  .min(QUIZ.MIN_QUESTIONS_PER_SECTION)
  .max(QUIZ.MAX_QUESTIONS_PER_SECTION);

/**
 * Correctif N1 (audit 2026-07-20) : la leçon de fin de section n'avait AUCUN
 * article propre — `Lesson.assets.articleMd` pointait vers le Markdown du
 * quiz lui-même (solutions comprises). Ce schéma minimal produit une courte
 * synthèse de section (300-500 mots, pas les 800-1500 d'un article complet)
 * pour donner une vraie conclusion écrite avant le quiz, sans spoiler les
 * réponses.
 */
const sectionSynthesisSchema = z.object({ markdown: z.string().min(100) });

const MIN_SYNTHESIS_WORDS = 150;
const MAX_SYNTHESIS_TOKENS = 2048;

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

  // Détection d'hallucination structurelle (P121) : bonne réponse dupliquée parmi les choix.
  problems.push(...checkQuizNoDuplicateCorrectAnswer(questions));

  return problems;
}

/**
 * Appelle le LLM (ou la fixture mock) et boucle jusqu'à obtenir un quiz
 * conforme aux règles métier, en réinjectant les violations en feedback.
 */
export async function generateQuizQuestions(
  input: QuizPromptInput,
  cost?: CostContext,
  directives?: string,
  llmProviderId?: string,
): Promise<QuizQuestion[]> {
  const system = quizSystemPrompt();
  // Phase 10 — consignes avancées (pédagogie + domaine, dont certification).
  const baseUser = quizUserPrompt(input) + (directives ?? '');

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
      // Retry métier (P72) : feedback potentiellement identique d'une tentative
      // à l'autre — désactive le cache pour ne pas rejouer la même réponse.
      skipCache: attempt > 1,
      ...(cost ? { cost } : {}),
      ...(llmProviderId ? { llmProviderId } : {}),
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

export interface SectionSynthesisInput {
  courseTitle: string;
  sectionTitle: string;
  locale: 'fr' | 'en' | 'ar';
  sectionLessons?: readonly { title: string; summary?: string }[];
}

const LOCALE_LABELS: Record<SectionSynthesisInput['locale'], string> = {
  fr: 'français',
  en: 'anglais',
  ar: 'arabe',
};

/**
 * Courte synthèse de clôture de section (correctif N1) — appelée par
 * `generateQuiz` pour donner à la leçon quiz un VRAI article de conclusion,
 * distinct du document questions/solutions. Best-effort : en cas d'échec, le
 * quiz reste généré sans article (mieux qu'un faux article = copie du quiz).
 */
export async function generateSectionSynthesis(
  input: SectionSynthesisInput,
  cost?: CostContext,
): Promise<string> {
  const { courseTitle, sectionTitle, locale, sectionLessons } = input;
  const system = [
    `Tu rédiges la conclusion écrite de fin de section d'un cours en ligne.`,
    `Synthétise ce qui a été appris — ne pose AUCUNE question, ne révèle AUCUNE réponse de quiz.`,
    `300 à 500 mots, en ${LOCALE_LABELS[locale]}, Markdown avec un titre "## Ce qu'il faut retenir" et un encadré final "> **À retenir**".`,
    `Réponds UNIQUEMENT avec un objet JSON {"markdown": string} — aucun texte autour, aucune fence.`,
  ].join('\n');
  const user = [
    `Cours « ${courseTitle} » — synthèse de fin de section « ${sectionTitle} ».`,
    ...(sectionLessons && sectionLessons.length > 0
      ? [
          '',
          'Leçons couvertes par la section :',
          ...sectionLessons.map((l) => `- ${l.title}${l.summary ? ` — ${l.summary}` : ''}`),
        ]
      : []),
  ].join('\n');

  const { markdown } = await callClaudeJson({
    schema: sectionSynthesisSchema,
    system,
    user,
    maxTokens: MAX_SYNTHESIS_TOKENS,
    ...(cost ? { cost } : {}),
  });

  const words = markdown.split(/\s+/).filter(Boolean).length;
  if (words < MIN_SYNTHESIS_WORDS) {
    logger.warn({ sectionTitle, words }, 'synthèse de section acceptée malgré une longueur insuffisante');
  }
  return markdown;
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
  /** Override de provider LLM pour cette régénération (« éditer avec l'IA »). */
  llmProviderId?: string;
}): Promise<QuizGenerationResult> {
  const { courseId, lessonId, context, llmProviderId } = params;

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
    renderGenerationDirectives(course.advancedParams, 'quiz'),
    llmProviderId ?? course.llmProvider,
  );

  // Persistance — upsert idempotent : un retry BullMQ remplace les questions.
  await Quiz.findOneAndUpdate(
    { lessonId: lesson._id },
    { $set: { courseId: course._id, sectionId: section._id, questions } },
    { upsert: true },
  );

  // Exports S3 : JSON brut (consommé par le packaging) + Markdown « Quiz + Solutions ».
  // Correctif N1 (audit 2026-07-20) : la doc questions/solutions vit désormais
  // sous sa PROPRE clé (`quizSolutions()`), plus jamais sous `article()` — sinon
  // la leçon expose le quiz (réponses comprises) comme si c'était son article.
  const keys = storageKeys.course(courseId).lesson(section.order, lesson.order);
  const quizKey = keys.quiz();
  const solutionsKey = keys.quizSolutions();
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

  // Vrai article de clôture (best-effort) : le cours ne doit pas se terminer
  // abruptement sur un quiz sans synthèse écrite. Un échec ici ne doit jamais
  // faire échouer la génération du quiz lui-même — on log et on continue sans
  // article plutôt que de retomber sur le document quiz (régression N1).
  let articleKey: string | undefined;
  try {
    const synthesisMarkdown = await generateSectionSynthesis(
      { courseTitle: course.title, sectionTitle: section.title, locale: course.locale, sectionLessons },
      { courseId, userId: String(course.userId) },
    );
    articleKey = keys.article();
    await uploadObject(articleKey, synthesisMarkdown, 'text/markdown; charset=utf-8');
    lesson.assets.articleMd = articleKey;
  } catch (err) {
    logger.warn({ courseId, lessonId, err }, 'synthèse de section non générée — quiz sans article de clôture');
  }

  lesson.status = 'ready';
  await lesson.save();

  logger.info(
    { courseId, lessonId, questions: questions.length, quizKey, solutionsKey, articleKey },
    'quiz généré et persisté',
  );
  return { lessonId, questions: questions.length, quizKey, solutionsKey };
}
