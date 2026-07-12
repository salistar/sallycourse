import { z } from 'zod';
import { getConfig, quizQuestionSchema, QUIZ, type QuizQuestion } from '@sallycourse/shared';
import { logger } from './logger';

/**
 * Générateur d'exercices supplémentaires à la demande (Prompt 145) — bouton
 * étudiant « Plus d'exercices » sur le LMS interne. Analyse les questions
 * ratées lors de la dernière tentative de quiz (LessonProgress.wrongAnswers)
 * pour cibler 3-5 nouvelles questions sur les THÈMES faibles de l'étudiant,
 * avec correction détaillée. Appel Claude direct via fetch (même pattern que
 * moderateCourseTitle / testPrompt : pas de @anthropic-ai/sdk côté web).
 * MOCK-friendly : MOCK_PROVIDERS=true (ou clé absente) → fixture déterministe.
 */

/** Une question ratée telle que stockée sur LessonProgress.wrongAnswers. */
export interface WrongAnswerInput {
  question: string;
  theme: string;
  pickedIndex: number;
  correctIndex: number;
}

/** Nombre de nouvelles questions générées par demande. */
export const EXERCISE_MIN_QUESTIONS = 3;
export const EXERCISE_MAX_QUESTIONS = 5;

/**
 * Sélectionne les thèmes faibles depuis l'historique des réponses ratées :
 * dédupliqués, triés du plus fréquent au moins fréquent (thème répété = point
 * faible plus marqué). PURE — aucune I/O, entièrement testable.
 */
export function selectWeakThemes(wrongAnswers: readonly WrongAnswerInput[]): string[] {
  const counts = new Map<string, number>();
  for (const wa of wrongAnswers) {
    const theme = wa.theme.trim();
    if (!theme) continue;
    counts.set(theme, (counts.get(theme) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([theme]) => theme);
}

/** Nombre de questions à générer selon le nombre de thèmes faibles distincts. */
export function exerciseCountForThemes(themeCount: number): number {
  if (themeCount <= 0) return EXERCISE_MIN_QUESTIONS;
  return Math.min(EXERCISE_MAX_QUESTIONS, Math.max(EXERCISE_MIN_QUESTIONS, themeCount + 1));
}

export interface ExercisePromptInput {
  courseTitle: string;
  lessonTitle: string;
  locale: 'fr' | 'en' | 'ar';
  weakThemes: string[];
  /** Questions ratées — sert d'exemples concrets des erreurs à ne pas reproduire. */
  wrongAnswers: readonly WrongAnswerInput[];
  questionCount: number;
}

const LOCALE_LABELS: Record<ExercisePromptInput['locale'], string> = {
  fr: 'français',
  en: 'anglais',
  ar: 'arabe',
};

/** Prompt système : contrat de sortie JSON strict (tableau de quizQuestionSchema). */
export function exerciseSystemPrompt(): string {
  return [
    `Tu es un tuteur pédagogique qui génère des exercices de remédiation personnalisés.`,
    `On te donne les thèmes sur lesquels un étudiant précis a échoué à un quiz, ainsi que les`,
    `questions ratées. Génère de NOUVELLES questions (jamais les mêmes) qui ciblent ces`,
    `thèmes faibles pour aider l'étudiant à progresser.`,
    ``,
    `RÈGLES IMPÉRATIVES :`,
    `1. Chaque question a exactement ${QUIZ.CHOICES_PER_QUESTION} choix, tous distincts, une seule bonne réponse.`,
    `2. Les questions portent SUR LES THÈMES FAIBLES fournis — pas de hors-sujet.`,
    `3. Ne reformule pas simplement les questions ratées : varie l'angle pour vérifier une vraie compréhension.`,
    `4. "explanation" est OBLIGATOIRE et détaillée : justifie la bonne réponse ET réfute chaque distracteur.`,
    `5. Difficulté progressive et bienveillante : l'objectif est de faire progresser, pas de sanctionner à nouveau.`,
    ``,
    `FORMAT DE SORTIE — réponds UNIQUEMENT avec un tableau JSON (aucun texte autour, aucune fence Markdown) :`,
    `[`,
    `  {`,
    `    "question": string,`,
    `    "choices": [string, string, string, string],`,
    `    "correctIndex": number (0 à ${QUIZ.CHOICES_PER_QUESTION - 1}),`,
    `    "explanation": string,`,
    `    "difficulty": "beginner" | "intermediate" | "advanced"`,
    `  }`,
    `]`,
  ].join('\n');
}

/** Prompt utilisateur : thèmes faibles + questions ratées en contexte. */
export function exerciseUserPrompt(input: ExercisePromptInput): string {
  const { courseTitle, lessonTitle, locale, weakThemes, wrongAnswers, questionCount } = input;
  const lines = [
    `Génère ${questionCount} nouvelles questions de remédiation pour la leçon « ${lessonTitle} »`,
    `du cours « ${courseTitle} ».`,
    `Langue : toutes les questions, choix et explications sont rédigés en ${LOCALE_LABELS[locale]}.`,
    ``,
    `Thèmes faibles à cibler en priorité (du plus fréquent au moins fréquent) :`,
    ...weakThemes.map((theme) => `- ${theme}`),
  ];
  if (wrongAnswers.length > 0) {
    lines.push(
      ``,
      `Questions ratées lors de la dernière tentative (pour contexte — NE PAS les reformuler à l'identique) :`,
      ...wrongAnswers.map((wa) => `- [${wa.theme}] ${wa.question}`),
    );
  }
  return lines.join('\n');
}

/** Tableau de questions attendu du LLM — bornes 3 à 5 (P145). */
export const exerciseArraySchema = z
  .array(quizQuestionSchema)
  .min(EXERCISE_MIN_QUESTIONS)
  .max(EXERCISE_MAX_QUESTIONS);

interface AnthropicMessageResponse {
  content: { type: string; text?: string }[];
}

/** Extrait le premier bloc JSON (tableau) d'une réponse texte. */
function extractJsonArrayPayload(raw: string): string {
  const trimmed = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fence?.[1]) return fence[1].trim();
  if (trimmed.startsWith('[')) return trimmed;
  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');
  if (firstBracket >= 0 && lastBracket > firstBracket) return trimmed.slice(firstBracket, lastBracket + 1);
  return trimmed;
}

/** Fixture déterministe (mode mock) — dérivée des thèmes faibles, sans appel réseau. */
function mockExercises(input: ExercisePromptInput): QuizQuestion[] {
  const themes = input.weakThemes.length > 0 ? input.weakThemes : ['révision générale'];
  return Array.from({ length: input.questionCount }, (_, i) => {
    const theme = themes[i % themes.length]!;
    return {
      question: `[mock] Question de remédiation ${i + 1} sur « ${theme} » (${input.lessonTitle})`,
      choices: [
        `Réponse correcte sur ${theme}`,
        `Distracteur plausible A`,
        `Distracteur plausible B`,
        `Distracteur plausible C`,
      ],
      correctIndex: 0,
      explanation: `[Réponse simulée — MOCK_PROVIDERS actif ou clé Anthropic absente] Explication ciblée sur « ${theme} ».`,
      difficulty: 'beginner' as const,
    };
  });
}

/**
 * Génère les exercices personnalisés via Claude (ou fixture mock). En cas
 * d'échec technique (réseau, JSON invalide), jette — l'appelant (route API)
 * retourne alors une erreur 502 explicite plutôt que de servir des exercices
 * non fiables.
 */
export async function generatePersonalizedExercises(
  input: ExercisePromptInput,
): Promise<QuizQuestion[]> {
  const config = getConfig();

  if (config.MOCK_PROVIDERS || !config.ANTHROPIC_API_KEY) {
    return mockExercises(input);
  }

  const system = exerciseSystemPrompt();
  const user = exerciseUserPrompt(input);
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
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    logger.warn({ status: response.status }, 'generatePersonalizedExercises : appel Claude en échec');
    throw new Error(`Échec de l'appel Claude (HTTP ${response.status}).`);
  }

  const data = (await response.json()) as AnthropicMessageResponse;
  const text = data.content
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text)
    .join('\n');

  const parsed = exerciseArraySchema.safeParse(JSON.parse(extractJsonArrayPayload(text)));
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, 'generatePersonalizedExercises : JSON invalide');
    throw new Error('Réponse du générateur non conforme au format attendu.');
  }
  return parsed.data;
}
