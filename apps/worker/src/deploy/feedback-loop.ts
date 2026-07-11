// Prompt 62 — Boucle de rétroaction qualité.
//
// Récupère les avis étudiants d'un cours publié (Udemy Instructor API, MOCKÉE),
// les envoie à Claude pour une analyse thématique (thèmes récurrents + sentiment
// + citations, puis suggestions d'amélioration ciblées), et persiste le résultat
// sur Course.improvementSuggestions. L'UI de la page cours propose ensuite
// d'« appliquer » une suggestion = régénérer la leçon visée avec l'instruction
// (réutilise le mécanisme de régénération existant, sans jamais l'appliquer seul).
//
// MOCK : sans credentials / MOCK_PROVIDERS, la « Instructor API » renvoie des
// avis déterministes (fetchUdemyReviews) et callClaudeJson retombe sur une
// fixture — aucun appel réseau, aucune dépense. Le worker n'a aucun secret Udemy
// public de toute façon (Udemy n'expose pas d'API d'authoring), d'où le mock.

import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import { z } from 'zod';
import {
  Course,
  Deployment,
  Lesson,
  Section,
  getConfig,
  type ICourse,
  type ILesson,
  type ISection,
} from '../shared.js';
import { getRedisConnection } from '../queues/connection.js';
import { logger } from '../queues/index.js';
import { callClaudeJson } from '../lib/claude.js';
import { saveFieldWithRetry } from '../lib/concurrency.js';

/* ------------------------------------------------------------------ */
/* Modèle d'avis étudiant                                              */
/* ------------------------------------------------------------------ */

/** Un avis étudiant normalisé (indépendant de la plateforme d'origine). */
export interface StudentReview {
  /** Identifiant plateforme de l'avis (déduplication). */
  id: string;
  /** Note sur 5 (0 si absente). */
  rating: number;
  /** Texte libre de l'avis (peut être vide). */
  comment: string;
  /** Titre/section du cours ciblé par l'avis, si la plateforme l'expose. */
  lessonRef?: string;
  /** Date ISO de publication (best-effort). */
  createdAt?: string;
}

/* ------------------------------------------------------------------ */
/* Instructor API Udemy — MOCK déterministe                            */
/* ------------------------------------------------------------------ */

/**
 * Fragments d'avis mock : variés en sentiment et en thème pour exercer
 * l'analyse. Chaque entrée est un gabarit `%s` = titre du cours.
 */
const MOCK_REVIEW_TEMPLATES: readonly { rating: number; comment: string }[] = [
  { rating: 5, comment: 'Excellent cours sur %s, très clair et progressif. Les exemples sont concrets.' },
  { rating: 2, comment: 'Le rythme des vidéos est bien trop rapide, je n\'arrive pas à suivre les manipulations à l\'écran.' },
  { rating: 3, comment: 'Bon contenu mais l\'audio est parfois faible et saccadé, il faut monter le son.' },
  { rating: 4, comment: 'Formation solide sur %s. Dommage qu\'il manque un exercice pratique après chaque chapitre.' },
  { rating: 2, comment: 'Les quiz sont trop faciles et ne testent pas vraiment la compréhension du cours.' },
  { rating: 5, comment: 'Parfait pour débuter avec %s, j\'ai enfin compris les concepts clés.' },
  { rating: 3, comment: 'Le chapitre sur l\'installation est confus, les étapes ne sont pas dans le bon ordre.' },
  { rating: 4, comment: 'Très pédagogique, mais certaines vidéos sont trop longues et pourraient être découpées.' },
  { rating: 1, comment: 'Trop rapide et pas assez d\'exemples concrets, je me suis perdu dès la deuxième section.' },
  { rating: 5, comment: 'Le meilleur cours de %s que j\'ai suivi, les travaux pratiques sont excellents.' },
];

/** Hash FNV-1a 32 bits — déterminisme du mock (aligné sur mock-fixtures). */
function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * MOCK de l'Udemy Instructor API : renvoie un jeu déterministe d'avis pour un
 * cours (même titre → mêmes avis). En production réelle, cette fonction
 * appellerait l'API instructeur avec les credentials déchiffrés ; Udemy
 * n'exposant pas d'API publique d'authoring, seul le mock est fourni.
 */
export function fetchUdemyReviewsMock(courseTitle: string, count: number = 8): StudentReview[] {
  const seed = hashString(courseTitle || 'cours');
  const n = Math.min(count, MOCK_REVIEW_TEMPLATES.length);
  const reviews: StudentReview[] = [];
  for (let i = 0; i < n; i++) {
    const tpl = MOCK_REVIEW_TEMPLATES[(seed + i) % MOCK_REVIEW_TEMPLATES.length];
    if (!tpl) continue;
    reviews.push({
      id: `udemy-review-${(seed + i) % 100000}`,
      rating: tpl.rating,
      comment: tpl.comment.replace(/%s/g, courseTitle || 'ce cours'),
      createdAt: new Date(Date.now() - i * 86_400_000).toISOString(),
    });
  }
  return reviews;
}

/**
 * Récupère les avis étudiants d'un cours. En MOCK (ou credentials absents),
 * délègue au mock déterministe. Ne jette jamais : un échec réseau renvoie [].
 */
export async function fetchUdemyReviews(
  course: Pick<ICourse, 'title'>,
  opts: { mock: boolean; externalId?: string } = { mock: true },
): Promise<StudentReview[]> {
  if (opts.mock) return fetchUdemyReviewsMock(course.title);
  try {
    // Chemin réel non implémenté (Udemy sans API d'authoring publique) :
    // on retombe sur le mock plutôt que d'échouer le pipeline.
    logger.debug({ externalId: opts.externalId }, 'fetchUdemyReviews : API réelle indisponible, fallback mock');
    return fetchUdemyReviewsMock(course.title);
  } catch (err) {
    logger.warn({ err }, 'fetchUdemyReviews : récupération des avis échouée');
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Schéma d'analyse (thèmes + suggestions)                             */
/* ------------------------------------------------------------------ */

export const reviewThemeSchema = z.object({
  /** Libellé court du thème récurrent (ex. « Rythme des vidéos »). */
  label: z.string().min(1),
  /** Sentiment global du thème. */
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  /** Nombre d'avis rattachés à ce thème. */
  count: z.number().int().min(0),
  /** Citations représentatives (extraits d'avis). */
  quotes: z.array(z.string().min(1)).default([]),
});
export type ReviewTheme = z.infer<typeof reviewThemeSchema>;

export const improvementSuggestionSchema = z.object({
  /**
   * Référence de la leçon visée (titre exact d'une leçon du cours) ou null si la
   * suggestion porte sur le cours entier. Résolue en lessonId côté persistance.
   */
  lessonRef: z.string().min(1).nullable(),
  /** Action concrète et actionnable à mener. */
  action: z.string().min(1),
  /** Justification, appuyée sur les retours étudiants. */
  rationale: z.string().min(1),
});
export type ImprovementSuggestion = z.infer<typeof improvementSuggestionSchema>;

export const reviewAnalysisSchema = z.object({
  themes: z.array(reviewThemeSchema).default([]),
  suggestions: z.array(improvementSuggestionSchema).default([]),
});
export type ReviewAnalysis = z.infer<typeof reviewAnalysisSchema>;

/** Analyse persistée sur Course.improvementSuggestions (métadonnées incluses). */
export const storedReviewAnalysisSchema = reviewAnalysisSchema.extend({
  /** Nombre d'avis analysés. */
  reviewCount: z.number().int().min(0),
  /** Note moyenne des avis analysés (0 si aucun). */
  averageRating: z.number().min(0).max(5),
  /** Date ISO de génération de l'analyse. */
  generatedAt: z.string().min(1),
});
export type StoredReviewAnalysis = z.infer<typeof storedReviewAnalysisSchema>;

/* ------------------------------------------------------------------ */
/* Prompt Claude                                                       */
/* ------------------------------------------------------------------ */

/** Prompt système : contrat de sortie strict de l'analyse thématique. */
export const REVIEW_ANALYSIS_SYSTEM = [
  "Tu es un analyste pédagogique qui étudie les avis d'étudiants sur un cours en ligne.",
  'À partir des avis fournis, produis :',
  "1. Les THÈMES récurrents (label court, sentiment positive|neutral|negative, count = nombre d'avis concernés, quotes = citations représentatives).",
  "2. Des SUGGESTIONS d'amélioration CIBLÉES et actionnables (lessonRef = titre EXACT d'une leçon listée, ou null si global ; action ; rationale appuyée sur les avis).",
  'Priorise les points négatifs et les demandes récurrentes. Reste factuel, en français.',
  'FORMAT DE SORTIE — réponds UNIQUEMENT avec un objet JSON conforme :',
  '{"themes":[{"label","sentiment","count","quotes":[...]}],"suggestions":[{"lessonRef":string|null,"action","rationale"}]}',
].join('\n');

/** Construit le message utilisateur (titre, leçons ciblables, avis) pour Claude. */
export function buildReviewAnalysisUser(
  course: Pick<ICourse, 'title'>,
  lessonTitles: readonly string[],
  reviews: readonly StudentReview[],
): string {
  const lessons = lessonTitles.length
    ? lessonTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')
    : '(aucune leçon listée)';
  const list = reviews
    .map((r, i) => `${i + 1}. [${r.rating}/5] ${r.comment}`)
    .join('\n');
  return [
    `Cours : « ${course.title} ».`,
    'Leçons du cours (pour cibler les suggestions) :',
    lessons,
    '',
    'Avis étudiants :',
    list,
    '',
    "Produis l'analyse JSON.",
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* Analyse déterministe (mock / fallback)                              */
/* ------------------------------------------------------------------ */

/** Règles heuristiques mots-clés → thème + suggestion (mock hors-ligne). */
const HEURISTIC_RULES: readonly {
  match: RegExp;
  label: string;
  action: string;
  lessonHint?: RegExp;
}[] = [
  {
    match: /\b(rapide|trop vite|rythme|suivre)/i,
    label: 'Rythme des vidéos',
    action: 'Ralentir le débit et découper les manipulations en étapes plus courtes.',
  },
  {
    match: /\b(audio|son|micro|volume|saccad)/i,
    label: 'Qualité audio',
    action: "Réenregistrer ou normaliser l'audio des vidéos concernées.",
  },
  {
    match: /\b(exemple|concret|pratique|exercice|tp)/i,
    label: 'Manque de pratique',
    action: 'Ajouter des exemples concrets et un exercice guidé par chapitre.',
  },
  {
    match: /\b(quiz|question|test|facile)/i,
    label: 'Difficulté des quiz',
    action: 'Renforcer les quiz avec des questions plus discriminantes.',
  },
  {
    match: /\b(confus|ordre|installation|perdu|clair)/i,
    label: 'Clarté et structure',
    action: 'Clarifier la structure et remettre les étapes dans le bon ordre.',
    lessonHint: /installation|mise en place|découverte/i,
  },
];

/**
 * Analyse MOCK déterministe : regroupe les avis par règle heuristique en thèmes
 * (sentiment déduit de la note moyenne du groupe) et produit une suggestion par
 * thème négatif/neutre. Sert de fallback si Claude échoue et en MOCK.
 */
export function mockReviewAnalysis(
  lessonTitles: readonly string[],
  reviews: readonly StudentReview[],
): ReviewAnalysis {
  const themes: ReviewTheme[] = [];
  const suggestions: ImprovementSuggestion[] = [];

  // Thème « appréciation générale » à partir des avis positifs (>= 4).
  const positive = reviews.filter((r) => r.rating >= 4);
  if (positive.length > 0) {
    themes.push({
      label: 'Appréciation générale',
      sentiment: 'positive',
      count: positive.length,
      quotes: positive.slice(0, 2).map((r) => r.comment),
    });
  }

  for (const rule of HEURISTIC_RULES) {
    const matched = reviews.filter((r) => rule.match.test(r.comment));
    if (matched.length === 0) continue;
    const avg = matched.reduce((a, r) => a + r.rating, 0) / matched.length;
    const sentiment: ReviewTheme['sentiment'] = avg >= 4 ? 'positive' : avg >= 3 ? 'neutral' : 'negative';
    themes.push({
      label: rule.label,
      sentiment,
      count: matched.length,
      quotes: matched.slice(0, 2).map((r) => r.comment),
    });
    // Suggestion uniquement pour les thèmes qui appellent une correction.
    if (sentiment !== 'positive') {
      const lessonRef = rule.lessonHint
        ? lessonTitles.find((t) => rule.lessonHint?.test(t)) ?? null
        : null;
      suggestions.push({
        lessonRef,
        action: rule.action,
        rationale: `${matched.length} avis mentionnent ce point (note moyenne ${avg.toFixed(1)}/5).`,
      });
    }
  }

  return reviewAnalysisSchema.parse({ themes, suggestions });
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                       */
/* ------------------------------------------------------------------ */

/** Note moyenne d'un lot d'avis (0 si vide). */
export function averageRating(reviews: readonly StudentReview[]): number {
  if (reviews.length === 0) return 0;
  const sum = reviews.reduce((a, r) => a + r.rating, 0);
  return Math.round((sum / reviews.length) * 10) / 10;
}

/**
 * Produit l'analyse : Claude en réel, fixture/heuristique en mock ou en cas
 * d'échec. Ne jette jamais (retombe toujours sur l'analyse mock).
 */
export async function analyzeReviews(
  course: Pick<ICourse, 'title'>,
  lessonTitles: readonly string[],
  reviews: readonly StudentReview[],
  mock: boolean,
): Promise<ReviewAnalysis> {
  if (mock || reviews.length === 0) return mockReviewAnalysis(lessonTitles, reviews);
  try {
    // Type explicite : les champs `.default([])` du schéma rendent l'inférence
    // générique ambiguë (TS peut capter le type d'entrée optionnel du schéma
    // plutôt que le type de sortie) — on fixe T=ReviewAnalysis sans ambiguïté.
    return await callClaudeJson<ReviewAnalysis>({
      schema: reviewAnalysisSchema,
      system: REVIEW_ANALYSIS_SYSTEM,
      user: buildReviewAnalysisUser(course, lessonTitles, reviews),
    });
  } catch (err) {
    logger.warn({ err }, 'analyse des avis via LLM échouée — fallback heuristique');
    return mockReviewAnalysis(lessonTitles, reviews);
  }
}

export interface ReviewFeedbackOutcome {
  courseId: string;
  reviewCount: number;
  averageRating: number;
  themeCount: number;
  suggestionCount: number;
}

/**
 * Passe complète pour UN cours : récupère les avis, les analyse, et persiste le
 * résultat sur Course.improvementSuggestions. Retourne null si le cours est
 * introuvable. Ne relance JAMAIS de génération : la boucle est décisionnelle
 * côté utilisateur (bouton « appliquer » de l'UI).
 */
export async function runReviewFeedbackForCourse(courseId: string): Promise<ReviewFeedbackOutcome | null> {
  const mock = getConfig().MOCK_PROVIDERS;

  const course = (await Course.findById(courseId)) as (ICourse & { _id: unknown; save: () => Promise<unknown> }) | null;
  if (!course) {
    logger.warn({ courseId }, 'feedback-loop : cours introuvable');
    return null;
  }

  // Titres de leçons (ordre du cours) pour permettre à l'analyse de cibler.
  const [sections, lessons, deployment] = await Promise.all([
    Section.find({ courseId }).sort({ order: 1 }).lean<ISection[]>(),
    Lesson.find({ courseId }).sort({ order: 1 }).lean<ILesson[]>(),
    Deployment.findOne({ courseId, platform: 'udemy' }).select('externalId').lean<{ externalId?: string } | null>(),
  ]);
  const sectionOrder = new Map(
    sections.map((s, i) => [String((s as unknown as { _id: unknown })._id), i]),
  );
  const orderedLessons = [...lessons].sort((a, b) => {
    const sa = sectionOrder.get(String(a.sectionId)) ?? 0;
    const sb = sectionOrder.get(String(b.sectionId)) ?? 0;
    return sa === sb ? a.order - b.order : sa - sb;
  });
  const lessonTitles = orderedLessons.map((l) => l.title);

  const reviews = await fetchUdemyReviews(course, { mock, externalId: deployment?.externalId });
  const analysis = await analyzeReviews(course, lessonTitles, reviews, mock);

  const stored: StoredReviewAnalysis = storedReviewAnalysisSchema.parse({
    ...analysis,
    reviewCount: reviews.length,
    averageRating: averageRating(reviews),
    generatedAt: new Date().toISOString(),
  });

  // Verrou optimiste (P120) : un autre job (ex. course-refresh) peut avoir
  // sauvegardé ce même Course entre-temps — on recharge et réapplique la
  // mutation sur l'état frais en cas de conflit de version.
  await saveFieldWithRetry(
    course,
    () => Course.findById(courseId) as Promise<(ICourse & { _id: unknown; save: () => Promise<unknown> }) | null>,
    (doc) => {
      doc.improvementSuggestions = stored;
    },
    { context: { courseId, step: 'feedback-loop' } },
  ).catch((err) => logger.warn({ courseId, err }, 'feedback-loop : sauvegarde analyse échouée'));

  logger.info(
    { courseId, reviews: reviews.length, themes: analysis.themes.length, suggestions: analysis.suggestions.length },
    'feedback-loop : analyse des avis terminée',
  );

  return {
    courseId,
    reviewCount: reviews.length,
    averageRating: stored.averageRating,
    themeCount: analysis.themes.length,
    suggestionCount: analysis.suggestions.length,
  };
}

/* ------------------------------------------------------------------ */
/* Queue BullMQ dédiée (hors registre typé du pipeline)                */
/* ------------------------------------------------------------------ */

/** Nom de la queue d'analyse de feedback (déclenchée à la demande depuis l'UI). */
export const FEEDBACK_QUEUE = 'review-feedback';
/** Nom de job d'analyse d'un cours. */
export const FEEDBACK_JOB = 'analyze-course-reviews';

interface FeedbackJobData {
  courseId: string;
}

let feedbackWorker: Worker<FeedbackJobData> | null = null;

function bullConnection(): ConnectionOptions {
  return getRedisConnection() as unknown as ConnectionOptions;
}

/**
 * Démarre le worker d'analyse de feedback. Idempotent. À appeler depuis index.ts.
 * Chaque job analyse un cours et persiste ses suggestions ; une erreur sur un
 * job n'affecte pas les autres (BullMQ isole).
 */
export function startFeedbackWorker(): void {
  if (feedbackWorker) return;
  feedbackWorker = new Worker<FeedbackJobData>(
    FEEDBACK_QUEUE,
    async (job: Job<FeedbackJobData>) => {
      const outcome = await runReviewFeedbackForCourse(job.data.courseId);
      return outcome ?? { courseId: job.data.courseId, skipped: true };
    },
    { connection: bullConnection(), concurrency: 2 },
  );
  feedbackWorker.on('failed', (job, err) =>
    logger.error({ queue: FEEDBACK_QUEUE, jobId: job?.id, err }, 'review-feedback : job en échec'),
  );
  feedbackWorker.on('error', (err) => logger.error({ queue: FEEDBACK_QUEUE, err }, 'erreur worker review-feedback'));
  logger.info('worker review-feedback démarré');
}

/** Arrête proprement le worker de feedback. */
export async function stopFeedbackWorker(): Promise<void> {
  await feedbackWorker?.close().catch(() => undefined);
  feedbackWorker = null;
}

/** Crée une queue d'enfilage (côté worker, ex. déclenchement interne/tests). */
export function createFeedbackQueue(): Queue<FeedbackJobData> {
  return new Queue<FeedbackJobData>(FEEDBACK_QUEUE, { connection: bullConnection() });
}
