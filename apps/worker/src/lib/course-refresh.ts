// Mise à jour automatique des cours (Prompt 91).
//
//  1) detectOutdatedTopics : demande à Claude si le SUJET d'un cours a
//     probablement évolué depuis sa création. LIMITATION HONNÊTE : ceci
//     repose uniquement sur le raisonnement du modèle sur ses connaissances
//     (entraînement), PAS sur une recherche web en direct — le worker n'a
//     aujourd'hui aucune clé de recherche web. Si une telle clé est un jour
//     disponible (ex. Brave Search, Tavily…), brancher ici en enrichissant le
//     contexte envoyé à callClaudeJson avant l'appel (voir TODO plus bas).
//  2) Persistance des suggestions sur Course.refreshSuggestions (additif) +
//     notification utilisateur (P59) — jamais de régénération automatique :
//     un bouton « Mettre à jour » côté UI régénère la leçon ciblée en
//     réutilisant le mécanisme existant (POST /api/lessons/[id]/regenerate).
//  3) Scheduler BullMQ repeatable trimestriel (configurable), même pattern
//     que lib/analytics/refresh.ts et lib/retention.ts.
import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import { z } from 'zod';
import { Course, Lesson, getConfig, notify, type ICourse, type ILesson } from '../shared.js';
import { getRedisConnection } from '../queues/connection.js';
import { logger } from '../queues/index.js';
import { callClaudeJson } from './claude.js';
import { saveFieldWithRetry } from './concurrency.js';

/* ------------------------------------------------------------------ */
/* Seuil de fraîcheur — pas de détection sur un cours récent            */
/* ------------------------------------------------------------------ */

/** Un « trimestre » approximé en jours (90 j) — cadence par défaut du cron. */
export const REFRESH_QUARTER_DAYS = 90;

/**
 * Détermine si un cours est assez ancien pour justifier une détection
 * d'obsolescence (créé il y a au moins `thresholdDays` jours). Fonction pure —
 * aucune I/O. Un cours de moins d'un trimestre n'a structurellement pas pu
 * "dater" côté connaissances du modèle, on économise donc l'appel LLM.
 */
export function shouldCheckForOutdatedTopics(
  createdAt: Date,
  now: Date,
  thresholdDays: number = REFRESH_QUARTER_DAYS,
): boolean {
  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
  return now.getTime() - createdAt.getTime() >= thresholdMs;
}

/* ------------------------------------------------------------------ */
/* Schéma de détection (réponse LLM)                                   */
/* ------------------------------------------------------------------ */

export const suggestedUpdateSchema = z.object({
  /** Titre EXACT d'une leçon du cours (résolu en lessonId côté persistance). */
  lessonRef: z.string().min(1),
  /** Raison concrète de la suggestion (ce qui a probablement évolué). */
  reason: z.string().min(1),
});
export type SuggestedUpdate = z.infer<typeof suggestedUpdateSchema>;

export const outdatedTopicsDetectionSchema = z.object({
  /** true si le sujet du cours a probablement évolué depuis sa création. */
  likelyOutdated: z.boolean(),
  /** Motifs généraux (indépendants d'une leçon précise). */
  reasons: z.array(z.string().min(1)).default([]),
  /** Leçons ciblées à mettre à jour, avec justification. */
  suggestedUpdates: z.array(suggestedUpdateSchema).default([]),
});
export type OutdatedTopicsDetection = z.infer<typeof outdatedTopicsDetectionSchema>;

/** Détection persistée sur Course.refreshSuggestions (métadonnées incluses). */
export const refreshSuggestionsSchema = outdatedTopicsDetectionSchema.extend({
  /** Date ISO de la détection. */
  detectedAt: z.string().min(1),
  /** Cadence en jours utilisée pour ce cycle (traçabilité). */
  thresholdDays: z.number().int().min(1),
});
export type RefreshSuggestions = z.infer<typeof refreshSuggestionsSchema>;

/* ------------------------------------------------------------------ */
/* Prompt Claude                                                       */
/* ------------------------------------------------------------------ */

/** Prompt système : contrat de sortie strict de la détection d'obsolescence. */
export const OUTDATED_TOPICS_SYSTEM = [
  "Tu es un expert pédagogique qui évalue si le CONTENU d'un cours en ligne a",
  'probablement besoin d\'être mis à jour, en te basant UNIQUEMENT sur ton',
  "raisonnement et tes connaissances générales (tu n'as PAS accès à une",
  "recherche web en direct — ne prétends jamais vérifier une source en ligne).",
  'Réfléchis aux sujets techniques dont les outils, versions, APIs ou bonnes',
  "pratiques évoluent vite (frameworks, langages, plateformes, réglementations).",
  'Si le domaine du cours est stable dans le temps (soft skills, mathématiques',
  'fondamentales, histoire…), indique likelyOutdated=false.',
  'FORMAT DE SORTIE — réponds UNIQUEMENT avec un objet JSON conforme :',
  '{"likelyOutdated":boolean,"reasons":[string],"suggestedUpdates":[{"lessonRef":string,"reason":string}]}',
  'lessonRef DOIT être le titre EXACT d\'une leçon listée ci-dessous.',
].join('\n');

/** Construit le message utilisateur (titre, âge, leçons) pour Claude. */
export function buildOutdatedTopicsUser(
  course: Pick<ICourse, 'title'>,
  ageDays: number,
  lessonTitles: readonly string[],
): string {
  const lessons = lessonTitles.length
    ? lessonTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')
    : '(aucune leçon listée)';
  return [
    `Cours : « ${course.title} ».`,
    `Âge du cours : environ ${ageDays} jours depuis sa création.`,
    'Leçons du cours (pour cibler les suggestions) :',
    lessons,
    '',
    "Le sujet de ce cours a-t-il probablement évolué depuis sa création ?",
    "Réponds avec l'objet JSON attendu.",
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* Détection (Claude, mock-friendly)                                   */
/* ------------------------------------------------------------------ */

/**
 * Mots-clés associés à des domaines qui évoluent vite (heuristique de repli
 * hors-ligne / mock déterministe) — sert uniquement quand MOCK_PROVIDERS=true
 * ou en cas d'échec de l'appel LLM. Ne remplace jamais un vrai raisonnement
 * du modèle en production.
 */
const FAST_MOVING_KEYWORDS = [
  'framework', 'javascript', 'typescript', 'react', 'vue', 'angular', 'node',
  'python', 'ia', 'intelligence artificielle', 'machine learning', 'llm',
  'cloud', 'aws', 'azure', 'docker', 'kubernetes', 'api', 'sécurité',
  'blockchain', 'devops', 'seo', 'marketing digital',
] as const;

/**
 * Détection MOCK déterministe : le cours est jugé "probablement obsolète" si
 * son titre contient un mot-clé de domaine à évolution rapide ET qu'il est
 * assez ancien. Suggère la première leçon comme cible générique (best-effort
 * hors-ligne — un vrai appel LLM cible bien plus précisément).
 */
export function mockOutdatedTopicsDetection(
  course: Pick<ICourse, 'title'>,
  ageDays: number,
  lessonTitles: readonly string[],
): OutdatedTopicsDetection {
  const title = course.title.toLowerCase();
  const matched = FAST_MOVING_KEYWORDS.find((kw) => title.includes(kw));

  if (!matched) {
    return outdatedTopicsDetectionSchema.parse({
      likelyOutdated: false,
      reasons: [],
      suggestedUpdates: [],
    });
  }

  const firstLesson = lessonTitles[0];
  return outdatedTopicsDetectionSchema.parse({
    likelyOutdated: true,
    reasons: [
      `Le sujet « ${matched} » évolue rapidement (nouvelles versions/outils probables depuis ${ageDays} jours).`,
    ],
    suggestedUpdates: firstLesson
      ? [{ lessonRef: firstLesson, reason: `Vérifier que les informations sur « ${matched} » sont toujours à jour.` }]
      : [],
  });
}

/**
 * Détecte si le sujet d'un cours a probablement évolué. En MOCK, retombe
 * directement sur l'heuristique déterministe. En réel, appelle Claude et
 * retombe sur l'heuristique en cas d'échec (ne jette jamais).
 */
export async function detectOutdatedTopics(
  course: Pick<ICourse, 'title'>,
  ageDays: number,
  lessonTitles: readonly string[],
  mock: boolean,
): Promise<OutdatedTopicsDetection> {
  if (mock) return mockOutdatedTopicsDetection(course, ageDays, lessonTitles);
  try {
    // Type explicite : les champs `.default([])` du schéma rendent l'inférence
    // générique ambiguë — on fixe T=OutdatedTopicsDetection sans ambiguïté.
    // TODO(recherche web) : si une clé de recherche web devient disponible,
    // enrichir buildOutdatedTopicsUser avec des extraits de résultats récents
    // AVANT cet appel, pour ancrer la détection sur des faits vérifiés plutôt
    // que sur le seul raisonnement du modèle.
    return await callClaudeJson<OutdatedTopicsDetection>({
      schema: outdatedTopicsDetectionSchema,
      system: OUTDATED_TOPICS_SYSTEM,
      user: buildOutdatedTopicsUser(course, ageDays, lessonTitles),
    });
  } catch (err) {
    logger.warn({ err }, 'course-refresh : détection LLM échouée — fallback heuristique');
    return mockOutdatedTopicsDetection(course, ageDays, lessonTitles);
  }
}

/* ------------------------------------------------------------------ */
/* Orchestration par cours                                             */
/* ------------------------------------------------------------------ */

export interface CourseRefreshOutcome {
  courseId: string;
  checked: boolean;
  likelyOutdated: boolean;
  suggestionCount: number;
}

/**
 * Passe complète pour UN cours : vérifie l'âge, détecte l'obsolescence
 * probable, persiste sur Course.refreshSuggestions et notifie l'utilisateur
 * SEULEMENT si likelyOutdated=true (pas de bruit notification sinon).
 * N'applique jamais de régénération — décisionnel côté utilisateur.
 * Retourne null si le cours est introuvable.
 */
export async function runCourseRefreshCheck(
  courseId: string,
  now: Date = new Date(),
  thresholdDays: number = REFRESH_QUARTER_DAYS,
): Promise<CourseRefreshOutcome | null> {
  const course = (await Course.findById(courseId)) as
    | (ICourse & { _id: unknown; save: () => Promise<unknown> })
    | null;
  if (!course) {
    logger.warn({ courseId }, 'course-refresh : cours introuvable');
    return null;
  }

  if (!shouldCheckForOutdatedTopics(course.createdAt, now, thresholdDays)) {
    return { courseId, checked: false, likelyOutdated: false, suggestionCount: 0 };
  }

  const mock = getConfig().MOCK_PROVIDERS;
  const ageDays = Math.floor((now.getTime() - course.createdAt.getTime()) / (24 * 60 * 60 * 1000));

  const lessons = await Lesson.find({ courseId }).sort({ order: 1 }).lean<ILesson[]>();
  const lessonTitles = lessons.map((l) => l.title);

  const detection = await detectOutdatedTopics(course, ageDays, lessonTitles, mock);

  const stored: RefreshSuggestions = refreshSuggestionsSchema.parse({
    ...detection,
    detectedAt: now.toISOString(),
    thresholdDays,
  });

  // Verrou optimiste (P120) : un autre job (ex. feedback-loop) peut avoir
  // sauvegardé ce même Course entre le findById ci-dessus et ce save() — on
  // recharge et réapplique la mutation sur l'état frais en cas de conflit.
  await saveFieldWithRetry(
    course,
    () => Course.findById(courseId) as Promise<(ICourse & { _id: unknown; save: () => Promise<unknown> }) | null>,
    (doc) => {
      doc.refreshSuggestions = stored;
    },
    { context: { courseId, step: 'course-refresh' } },
  ).catch((err) => logger.warn({ courseId, err }, 'course-refresh : sauvegarde échouée'));

  if (detection.likelyOutdated) {
    await emitRefreshAvailable(course, detection).catch((err) =>
      logger.warn({ courseId, err }, 'course-refresh : notification échouée'),
    );
  }

  logger.info(
    { courseId, likelyOutdated: detection.likelyOutdated, suggestions: detection.suggestedUpdates.length },
    'course-refresh : vérification terminée',
  );

  // Résolution lessonRef → lessonId différée à la lecture côté API web
  // (même pattern que P62/toFeedbackView) : le worker persiste le titre exact,
  // l'UI résout vers lessonId au moment d'afficher le bouton « Mettre à jour ».
  return {
    courseId,
    checked: true,
    likelyOutdated: detection.likelyOutdated,
    suggestionCount: detection.suggestedUpdates.length,
  };
}

/**
 * Émet la notification « mise à jour disponible » pour le propriétaire du
 * cours. Best-effort : ne jette jamais (une notif ratée ne compromet rien).
 */
async function emitRefreshAvailable(
  course: { _id: unknown; userId: unknown; title?: string },
  detection: OutdatedTopicsDetection,
): Promise<void> {
  const courseId = String(course._id);
  const title = course.title ?? 'votre cours';
  await notify(String(course.userId), {
    type: 'course_refresh_available',
    title: 'Mise à jour suggérée',
    body: `Le cours « ${title} » pourrait nécessiter une mise à jour (${detection.suggestedUpdates.length} leçon(s) ciblée(s)).`,
    link: `/dashboard/courses/${courseId}`,
    // Pas de gabarit email pour ce type (voir EMAIL_TEMPLATE_BY_TYPE) : simple
    // suggestion consultable dans le dashboard, sans email dédié.
    email: false,
  });
}

/**
 * Vérifie tous les cours dont le statut permet une mise à jour utile ('ready'
 * ou 'published' — un brouillon n'a rien à mettre à jour). Ne relance jamais
 * de génération. Retourne le nombre de cours effectivement vérifiés (âge OK).
 */
export async function runCourseRefreshForAllEligible(now: Date = new Date()): Promise<number> {
  const courses = await Course.find({ status: { $in: ['ready', 'published'] } })
    .select('_id')
    .lean();

  let checked = 0;
  for (const c of courses) {
    try {
      const outcome = await runCourseRefreshCheck(String(c._id), now);
      if (outcome?.checked) checked += 1;
    } catch (err) {
      logger.warn({ courseId: String(c._id), err }, 'course-refresh : vérification cours échouée');
    }
  }
  return checked;
}

/* ------------------------------------------------------------------ */
/* Scheduler BullMQ repeatable (queue dédiée, même pattern que retention) */
/* ------------------------------------------------------------------ */

/** Queue cron dédiée à la détection de mise à jour (hors registre typé). */
export const COURSE_REFRESH_QUEUE = 'course-refresh';
/** Identifiant du job répétable (dédupliqué par BullMQ). */
export const COURSE_REFRESH_JOB = 'course-refresh-quarterly';
/**
 * Cadence par défaut : trimestrielle (1er de janvier/avril/juillet/octobre à
 * 6h), surchargée par COURSE_REFRESH_CRON. Configurable pour les tests/démos
 * (ex. cron plus fréquent en environnement de préproduction).
 */
const DEFAULT_CRON = '0 6 1 1,4,7,10 *';

interface CourseRefreshJobData {
  reason?: string;
}

let refreshQueue: Queue<CourseRefreshJobData> | null = null;
let refreshWorker: Worker<CourseRefreshJobData> | null = null;

function bullConnection(): ConnectionOptions {
  return getRedisConnection() as unknown as ConnectionOptions;
}

/**
 * Démarre le scheduler de mise à jour des cours : crée la queue, planifie le
 * job répétable (cron trimestriel) et démarre le worker qui exécute
 * runCourseRefreshForAllEligible. Idempotent. À appeler depuis index.ts.
 */
export async function startCourseRefreshScheduler(
  cron: string = process.env.COURSE_REFRESH_CRON?.trim() || DEFAULT_CRON,
): Promise<void> {
  if (refreshWorker) return;

  refreshQueue = new Queue<CourseRefreshJobData>(COURSE_REFRESH_QUEUE, { connection: bullConnection() });
  refreshQueue.on('error', (err) => logger.error({ queue: COURSE_REFRESH_QUEUE, err }, 'erreur queue course-refresh'));

  await refreshQueue.add(
    COURSE_REFRESH_JOB,
    { reason: 'cron' },
    { repeat: { pattern: cron }, jobId: COURSE_REFRESH_JOB, removeOnComplete: 20, removeOnFail: 50 },
  );

  refreshWorker = new Worker<CourseRefreshJobData>(
    COURSE_REFRESH_QUEUE,
    async (_job: Job<CourseRefreshJobData>) => {
      const checked = await runCourseRefreshForAllEligible();
      return { checked };
    },
    { connection: bullConnection(), concurrency: 1 },
  );
  refreshWorker.on('failed', (job, err) =>
    logger.error({ queue: COURSE_REFRESH_QUEUE, jobId: job?.id, err }, 'course-refresh : job en échec'),
  );
  refreshWorker.on('error', (err) => logger.error({ queue: COURSE_REFRESH_QUEUE, err }, 'erreur worker course-refresh'));

  logger.info({ cron }, 'scheduler course-refresh démarré');
}
/** Arrête proprement le scheduler (worker + queue). */
export async function stopCourseRefreshScheduler(): Promise<void> {
  await refreshWorker?.close().catch(() => undefined);
  await refreshQueue?.close().catch(() => undefined);
  refreshWorker = null;
  refreshQueue = null;
}
