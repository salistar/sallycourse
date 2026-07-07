// Prompt 47 — File d'attente review & alerting.
//
// Deux volets :
//  1) LOGIQUE PURE (testable hors-ligne) : normalisation des états de revue
//     hétérogènes des plateformes, détection de transition (approuvé / rejeté /
//     modifications demandées), parsing des raisons de rejet scrapées en liste
//     structurée, et construction du plan de correction (schéma Zod + prompt
//     Claude + fallback mock déterministe).
//  2) ORCHESTRATION : job cron BullMQ (repeatable) qui, chaque jour, interroge
//     le statut review des déploiements « en revue » via adapter.getStatus,
//     met à jour Deployment.reviewState, notifie l'utilisateur (log + canal de
//     progression), et — en cas de rejet — génère un plan de correction et le
//     PROPOSE (annotations/tâches persistées sur le Deployment) sans jamais
//     régénérer le cours automatiquement.
//
// MOCK : sans credentials / MOCK_PROVIDERS, getStatus des adapters simule déjà
// un état, callClaudeJson retourne une fixture, et aucun appel réseau n'est fait.

import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import { z } from 'zod';
import {
  Course,
  Deployment,
  Lesson,
  Section,
  PlatformCredential,
  QUEUES,
  decryptCredentials,
  getConfig,
  publishProgress,
  type DeploymentDocument,
  type DeploymentStatus,
  type ICourse,
  type ILesson,
  type ISection,
} from '../shared.js';
import { getRedisConnection } from '../queues/connection.js';
import { logger } from '../queues/index.js';
import { getAdapter, hasAdapter } from './registry.js';
import { callClaudeJson } from '../lib/claude.js';
import type {
  BoundPublishProgress,
  DeployContext,
  DeployCredentials,
  DeployStatus,
} from './types.js';

/* ------------------------------------------------------------------ */
/* Logique PURE — états de revue                                       */
/* ------------------------------------------------------------------ */

/** États de revue canoniques (normalisés depuis les libellés plateformes). */
export const REVIEW_STATES = [
  'in_review',
  'approved',
  'rejected',
  'changes_requested',
  'unknown',
] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

/**
 * Normalise un libellé de revue hétérogène (scrapé/renvoyé par une plateforme)
 * vers un état canonique. Insensible à la casse, tolérant aux variantes.
 */
export function normalizeReviewState(raw: string | undefined | null): ReviewState {
  if (!raw) return 'unknown';
  const s = raw.trim().toLowerCase();
  if (!s) return 'unknown';
  // Rejet explicite.
  if (/\b(reject|declin|denied|refus|not\s*approv)/.test(s)) return 'rejected';
  // Modifications demandées (le cours n'est pas rejeté mais doit être corrigé).
  if (/\b(change|revision|revise|resubmit|action\s*required|update\s*needed|modif)/.test(s)) {
    return 'changes_requested';
  }
  // Approuvé / publié / en ligne.
  if (/\b(approv|publish|accept|live|online|en\s*ligne|valid)/.test(s)) return 'approved';
  // En cours de revue.
  if (/\b(review|pending|submitted|in\s*progress|en\s*revue|attente)/.test(s)) return 'in_review';
  return 'unknown';
}

/** Un état de revue qui exige une action utilisateur (rejet ou modifs demandées). */
export function isActionableReviewState(state: ReviewState): boolean {
  return state === 'rejected' || state === 'changes_requested';
}

/** Un état terminal favorable (plus rien à surveiller). */
export function isApprovedReviewState(state: ReviewState): boolean {
  return state === 'approved';
}

/** Type de notification déclenchée par une transition d'état. */
export type ReviewNotificationKind = 'approved' | 'rejected' | 'changes_requested' | null;

export interface ReviewTransition {
  previous: ReviewState;
  next: ReviewState;
  /** true si l'état a changé de façon significative (déclenche une notification). */
  changed: boolean;
  /** Notification à envoyer (null = rien à signaler). */
  notify: ReviewNotificationKind;
  /** true si le déploiement doit rester surveillé au prochain poll. */
  keepPolling: boolean;
}

/**
 * Calcule la transition entre l'état de revue connu et le nouvel état observé.
 * - Toute entrée dans un état « actionnable » (rejected / changes_requested)
 *   notifie, même si l'état précédent était déjà le même n'est PAS re-notifié.
 * - L'approbation notifie une fois puis arrête le polling.
 */
export function reviewTransition(
  previous: string | undefined | null,
  next: string | undefined | null,
): ReviewTransition {
  const prev = normalizeReviewState(previous);
  const nxt = normalizeReviewState(next);
  const changed = prev !== nxt;

  let notify: ReviewNotificationKind = null;
  if (changed) {
    if (nxt === 'rejected') notify = 'rejected';
    else if (nxt === 'changes_requested') notify = 'changes_requested';
    else if (nxt === 'approved') notify = 'approved';
  }

  // On continue de surveiller tant que ce n'est pas approuvé (état favorable
  // terminal). Un rejet reste surveillé : l'utilisateur peut re-soumettre.
  const keepPolling = nxt !== 'approved';

  return { previous: prev, next: nxt, changed, notify, keepPolling };
}

/**
 * Statut de déploiement dérivé d'un état de revue (persisté sur Deployment.status).
 * approved → published ; rejected/changes_requested → failed (action requise) ;
 * sinon on conserve le statut courant.
 */
export function deploymentStatusFromReview(
  state: ReviewState,
  current: DeploymentStatus,
): DeploymentStatus {
  if (state === 'approved') return 'published';
  if (state === 'rejected') return 'failed';
  return current;
}

/* ------------------------------------------------------------------ */
/* Logique PURE — parsing des raisons de rejet                         */
/* ------------------------------------------------------------------ */

/** Sévérité d'une raison de rejet (heuristique de mots-clés). */
export type RejectionSeverity = 'blocker' | 'major' | 'minor';

export interface RejectionReason {
  /** Texte de la raison, nettoyé. */
  text: string;
  /** Catégorie devinée (audio, video, contenu, légal, qualité…). */
  category: string;
  severity: RejectionSeverity;
}

/** Déduit une catégorie grossière à partir du texte d'une raison. */
export function categorizeReason(text: string): string {
  const t = text.toLowerCase();
  if (/\b(audio|son|micro|bruit|volume|sound)/.test(t)) return 'audio';
  if (/\b(video|vidéo|image|résolution|resolution|screen|flou|blur)/.test(t)) return 'video';
  if (/\b(caption|subtitle|sous-titre|srt|transcript)/.test(t)) return 'captions';
  if (/\b(copyright|droit|licence|trademark|marque|legal|légal|plagiat)/.test(t)) return 'legal';
  if (/\b(promo|marketing|landing|description|thumbnail|vignette|title|titre)/.test(t)) {
    return 'landing';
  }
  if (/\b(quiz|exercice|exercise|assignment|évaluation|assessment)/.test(t)) return 'assessment';
  if (/\b(content|contenu|leçon|lesson|curriculum|structure|outline)/.test(t)) return 'content';
  return 'general';
}

/** Déduit une sévérité à partir de mots-clés (blocker/major/minor). */
export function severityOfReason(text: string): RejectionSeverity {
  const t = text.toLowerCase();
  if (/\b(reject|must|required|violation|prohibited|illegal|blocker|critique|obligatoire|interdit)/.test(t)) {
    return 'blocker';
  }
  if (/\b(should|improve|recommend|quality|unclear|missing|manquant|améliorer|recommand)/.test(t)) {
    return 'major';
  }
  return 'minor';
}

/**
 * Parse un texte brut de raisons de rejet (scrapé) en liste structurée.
 * Gère : lignes préfixées par puce (-, *, •, 1.), séparateurs de ligne, et
 * texte libre (une phrase par point). Déduplique et ignore les lignes vides.
 */
export function parseRejectionReasons(raw: string | undefined | null): RejectionReason[] {
  if (!raw) return [];
  const normalized = raw.replace(/\r\n/g, '\n');

  // 1) Découpe par lignes ; on retire les puces / numérotation de tête.
  let items = normalized
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, '').trim())
    .filter((line) => line.length > 0);

  // 2) Si tout tenait sur une seule ligne, on retombe sur un découpage par
  //    phrases (. ; ou •) pour ne pas produire un unique bloc.
  if (items.length <= 1 && normalized.trim().length > 0) {
    items = normalized
      .split(/(?:[.;•]|\s-\s)+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  const seen = new Set<string>();
  const reasons: RejectionReason[] = [];
  for (const text of items) {
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    reasons.push({ text, category: categorizeReason(text), severity: severityOfReason(text) });
  }
  return reasons;
}

/* ------------------------------------------------------------------ */
/* Logique PURE — plan de correction                                   */
/* ------------------------------------------------------------------ */

/** Une action de correction proposée (jamais appliquée sans consentement). */
export const correctionTaskSchema = z.object({
  /** Titre court et actionnable. */
  title: z.string().min(1),
  /** Détail de ce qu'il faut corriger et pourquoi. */
  detail: z.string().min(1),
  category: z.string().min(1),
  severity: z.enum(['blocker', 'major', 'minor']),
  /** Portée : leçon spécifique (index) ou cours entier. */
  scope: z.enum(['course', 'lesson', 'landing']),
  /** Index de leçon concernée si scope='lesson' (0-based), sinon null. */
  lessonIndex: z.number().int().min(0).nullable(),
  /** true si l'action peut être proposée en régénération automatique (après OK). */
  regenerable: z.boolean(),
});
export type CorrectionTask = z.infer<typeof correctionTaskSchema>;

export const correctionPlanSchema = z.object({
  summary: z.string().min(1),
  tasks: z.array(correctionTaskSchema).min(1),
});
export type CorrectionPlan = z.infer<typeof correctionPlanSchema>;

/** Prompt système du mapping raisons → plan de correction structuré. */
export const CORRECTION_PLAN_SYSTEM =
  "Tu es un assistant qui transforme les raisons de rejet d'un cours en ligne " +
  'en un plan de correction ACTIONNABLE. Réponds STRICTEMENT en JSON conforme au ' +
  'schéma : {"summary": string, "tasks": [{"title","detail","category",' +
  '"severity"(blocker|major|minor),"scope"(course|lesson|landing),' +
  '"lessonIndex"(entier|null),"regenerable"(bool)}]}. ' +
  "Ne propose PAS d'appliquer les corrections : tu ne fais que planifier. " +
  'Une tâche par raison, en français, concise.';

/** Construit le message utilisateur (contexte cours + raisons) pour Claude. */
export function buildCorrectionPlanUser(
  course: Pick<ICourse, 'title'>,
  reasons: RejectionReason[],
): string {
  const list = reasons
    .map((r, i) => `${i + 1}. [${r.severity}/${r.category}] ${r.text}`)
    .join('\n');
  return (
    `Cours : « ${course.title} ».\n` +
    `Raisons de rejet de la plateforme :\n${list}\n\n` +
    'Produis le plan de correction JSON.'
  );
}

/**
 * Plan de correction MOCK déterministe (hors-ligne) : une tâche par raison,
 * dérivée par heuristique. Sert de fallback si Claude échoue et en MOCK.
 */
export function mockCorrectionPlan(
  course: Pick<ICourse, 'title'>,
  reasons: RejectionReason[],
): CorrectionPlan {
  const tasks: CorrectionTask[] = reasons.map((r) => ({
    title: `Corriger : ${r.text.slice(0, 60)}`,
    detail: `Raison plateforme (${r.category}) : ${r.text}`,
    category: r.category,
    severity: r.severity,
    scope: r.category === 'landing' ? 'landing' : r.category === 'content' ? 'course' : 'lesson',
    lessonIndex: null,
    // On considère régénérables les problèmes de contenu/média (pas le légal).
    regenerable: r.category !== 'legal' && r.category !== 'general',
  }));
  return {
    summary: `Plan de correction pour « ${course.title} » : ${reasons.length} point(s) à traiter.`,
    tasks: tasks.length > 0 ? tasks : [
      {
        title: 'Revoir le cours',
        detail: 'Rejet sans détail exploitable — revue manuelle nécessaire.',
        category: 'general',
        severity: 'major',
        scope: 'course',
        lessonIndex: null,
        regenerable: false,
      },
    ],
  };
}

/**
 * Génère le plan de correction : Claude en réel, fixture/heuristique en mock ou
 * en cas d'échec. Ne jette jamais (retombe toujours sur le plan mock).
 */
export async function generateCorrectionPlan(
  course: Pick<ICourse, 'title'>,
  reasons: RejectionReason[],
  mock: boolean,
): Promise<CorrectionPlan> {
  if (mock || reasons.length === 0) return mockCorrectionPlan(course, reasons);
  try {
    return await callClaudeJson({
      schema: correctionPlanSchema,
      system: CORRECTION_PLAN_SYSTEM,
      user: buildCorrectionPlanUser(course, reasons),
    });
  } catch (err) {
    logger.warn({ err }, 'plan de correction via LLM échoué — fallback heuristique');
    return mockCorrectionPlan(course, reasons);
  }
}

/* ------------------------------------------------------------------ */
/* Orchestration — poll d'un déploiement                               */
/* ------------------------------------------------------------------ */

/** Étape logique stockée dans checkpoint.step d'un déploiement en revue. */
const REVIEW_STEP = 'review';

/** Statuts de déploiement encore susceptibles d'être en revue. */
const POLLABLE_STATUSES: DeploymentStatus[] = ['running', 'published', 'pending'];

/** publishProgress borné à un cours (best-effort, canal deployment). */
function boundProgress(courseId: string): BoundPublishProgress {
  return async (progress, message, level = 'info') => {
    try {
      await publishProgress(getRedisConnection(), {
        courseId,
        step: QUEUES.deployment,
        progress,
        message,
        level,
        ts: Date.now(),
      });
    } catch (err) {
      logger.warn({ courseId, err }, 'progression review non publiée');
    }
  };
}

/** Charge et déchiffre les credentials plateforme de l'utilisateur (vide en mock). */
async function loadCredentials(
  userId: unknown,
  platform: string,
  mock: boolean,
): Promise<DeployCredentials> {
  if (mock) return {};
  try {
    const cred = await PlatformCredential.findOne({ userId, platform }).lean<{ data?: string } | null>();
    if (!cred?.data) return {};
    return decryptCredentials(cred.data, getConfig().CREDENTIALS_MASTER_KEY);
  } catch (err) {
    logger.warn({ platform, err }, 'credentials review illisibles — mode simulé');
    return {};
  }
}

/**
 * Notifie l'utilisateur d'une transition de revue : entrée dans Deployment.logs
 * + publication sur le canal de progression (l'UI web s'y abonne).
 */
async function notifyUser(
  deployment: DeploymentDocument,
  courseId: string,
  transition: ReviewTransition,
  planSummary?: string,
): Promise<void> {
  const messages: Record<Exclude<ReviewNotificationKind, null>, string> = {
    approved: 'Bonne nouvelle : votre cours a été approuvé et publié.',
    rejected: `Votre cours a été rejeté à la revue.${planSummary ? ` ${planSummary}` : ''}`,
    changes_requested: `Des modifications sont demandées avant publication.${planSummary ? ` ${planSummary}` : ''}`,
  };
  if (!transition.notify) return;
  const level: 'info' | 'warn' = transition.notify === 'approved' ? 'info' : 'warn';
  const msg = messages[transition.notify];
  deployment.logs.push({ ts: new Date(), level, msg });
  await deployment.save().catch(() => undefined);
  await boundProgress(courseId)(
    transition.notify === 'approved' ? 100 : 95,
    msg,
    level,
  ).catch(() => undefined);
}

/**
 * Persiste le plan de correction sous forme d'annotations sur le Deployment
 * (logs structurés). On ne régénère RIEN : on propose. Chaque tâche devient
 * une entrée de log ; le résumé est journalisé et retourné.
 */
export async function attachCorrectionPlan(
  deployment: DeploymentDocument,
  plan: CorrectionPlan,
): Promise<void> {
  deployment.logs.push({
    ts: new Date(),
    level: 'warn',
    msg: `Plan de correction proposé : ${plan.summary}`,
  });
  for (const task of plan.tasks) {
    const scope =
      task.scope === 'lesson' && task.lessonIndex !== null
        ? `leçon ${task.lessonIndex + 1}`
        : task.scope;
    deployment.logs.push({
      ts: new Date(),
      level: 'warn',
      msg: `[${task.severity}] (${scope}) ${task.title} — ${task.detail}${task.regenerable ? ' [régénération proposée]' : ''}`,
    });
  }
  await deployment.save().catch(() => undefined);
}

export interface ReviewPollOutcome {
  deploymentId: string;
  platform: string;
  reviewState: ReviewState;
  notified: ReviewNotificationKind;
  planTasks: number;
}

/**
 * Poll d'UN déploiement en revue : interroge l'adapter, calcule la transition,
 * met à jour reviewState/status, notifie, et génère un plan si rejet.
 */
export async function pollDeploymentReview(
  deployment: DeploymentDocument,
  mock: boolean,
): Promise<ReviewPollOutcome | null> {
  const platform = deployment.platform;
  const courseId = String(deployment.courseId);
  if (!hasAdapter(platform)) {
    logger.debug({ platform }, 'review-poll : aucun adapter pour la plateforme, ignoré');
    return null;
  }

  const course = (await Course.findById(deployment.courseId)) as
    | (ICourse & { _id: unknown })
    | null;
  if (!course) return null;

  const [sections, lessons, credentials] = await Promise.all([
    Section.find({ courseId: course._id }).sort({ order: 1 }).lean<ISection[]>(),
    Lesson.find({ courseId: course._id }).sort({ order: 1 }).lean<ILesson[]>(),
    loadCredentials(deployment.userId, platform, mock),
  ]);

  const ctx: DeployContext = {
    platform,
    mode: deployment.mode,
    course,
    sections,
    lessons,
    credentials,
    checkpoint: {
      lessonIndex: deployment.checkpoint?.lessonIndex ?? 0,
      step: deployment.checkpoint?.step ?? REVIEW_STEP,
    },
    externalId: undefined,
    publishProgress: boundProgress(courseId),
    logger,
    mock,
    deployment,
  };

  let status: DeployStatus;
  try {
    status = await getAdapter(platform).getStatus(ctx);
  } catch (err) {
    logger.warn({ platform, courseId, err }, 'review-poll : getStatus a échoué');
    return null;
  }

  // reviewState précédent = dernier connu (déduit du statut/log via un champ
  // logique : on stocke l'état canonique dans checkpoint.step au-delà de 'review').
  const previous = readStoredReviewState(deployment);
  const transition = reviewTransition(previous, status.reviewState);

  // Mise à jour du statut et de l'URL.
  deployment.status = deploymentStatusFromReview(transition.next, deployment.status);
  if (status.externalUrl) deployment.externalUrl = status.externalUrl;
  storeReviewState(deployment, transition.next);

  let planTasks = 0;
  let planSummary: string | undefined;
  // Génération du plan de correction en cas d'entrée dans un état actionnable.
  if (transition.changed && isActionableReviewState(transition.next)) {
    const reasons = parseRejectionReasons(status.reviewState ?? '')
      .concat(parseRejectionReasons(scrapedReasonsFrom(status)));
    const dedup = dedupeReasons(reasons);
    const plan = await generateCorrectionPlan(course, dedup, mock);
    planSummary = plan.summary;
    planTasks = plan.tasks.length;
    await attachCorrectionPlan(deployment, plan);
  }

  await deployment.save().catch(() => undefined);
  await notifyUser(deployment, courseId, transition, planSummary);

  return {
    deploymentId: String(deployment._id),
    platform,
    reviewState: transition.next,
    notified: transition.notify,
    planTasks,
  };
}

/**
 * Récupère un texte de raisons scrapées si l'adapter en a exposé un via un champ
 * additionnel du DeployStatus (rétrocompatible : optionnel).
 */
function scrapedReasonsFrom(status: DeployStatus): string {
  const extra = status as DeployStatus & { rejectionReasons?: string };
  return typeof extra.rejectionReasons === 'string' ? extra.rejectionReasons : '';
}

/** Déduplique une liste de raisons par texte normalisé. */
export function dedupeReasons(reasons: RejectionReason[]): RejectionReason[] {
  const seen = new Set<string>();
  const out: RejectionReason[] = [];
  for (const r of reasons) {
    const key = r.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/**
 * L'état de revue canonique est mémorisé dans checkpoint.step sous la forme
 * `review:<state>` pour survivre entre deux polls sans nouveau champ de schéma.
 */
export function storeReviewState(deployment: DeploymentDocument, state: ReviewState): void {
  deployment.checkpoint = {
    lessonIndex: deployment.checkpoint?.lessonIndex ?? deployment.logs.length,
    step: `${REVIEW_STEP}:${state}`,
  };
}

/** Lit l'état de revue mémorisé dans checkpoint.step (`review:<state>`). */
export function readStoredReviewState(deployment: DeploymentDocument): ReviewState {
  const step = deployment.checkpoint?.step ?? '';
  const match = /^review:(.+)$/.exec(step);
  if (!match) return 'unknown';
  const stored = match[1] as ReviewState;
  // La valeur mémorisée est déjà canonique : on la retourne telle quelle si
  // elle appartient à l'énumération, sinon on tente une normalisation.
  return REVIEW_STATES.includes(stored) ? stored : normalizeReviewState(stored);
}

/* ------------------------------------------------------------------ */
/* Orchestration — passe complète                                     */
/* ------------------------------------------------------------------ */

/**
 * Parcourt tous les déploiements susceptibles d'être en revue et les poll.
 * Chaque déploiement est isolé (une erreur n'interrompt pas les autres).
 */
export async function pollReviews(): Promise<ReviewPollOutcome[]> {
  const mock = getConfig().MOCK_PROVIDERS;
  const deployments = await Deployment.find({
    status: { $in: POLLABLE_STATUSES },
    // On ne surveille pas les déploiements déjà approuvés/publiés définitivement.
    'checkpoint.step': { $ne: `${REVIEW_STEP}:approved` },
  });

  const outcomes: ReviewPollOutcome[] = [];
  for (const deployment of deployments) {
    try {
      const outcome = await pollDeploymentReview(deployment, mock);
      if (outcome) outcomes.push(outcome);
    } catch (err) {
      logger.error({ deploymentId: String(deployment._id), err }, 'review-poll : échec sur un déploiement');
    }
  }
  logger.info({ polled: deployments.length, outcomes: outcomes.length }, 'review-poll : passe terminée');
  return outcomes;
}

/* ------------------------------------------------------------------ */
/* Scheduler BullMQ repeatable (queue dédiée hors registre typé)       */
/* ------------------------------------------------------------------ */

/** Nom de la queue cron dédiée au polling review (hors QUEUES du pipeline). */
export const REVIEW_POLL_QUEUE = 'review-poll';
/** Identifiant du job répétable (dédupliqué par BullMQ). */
export const REVIEW_POLL_JOB = 'review-poll-daily';
/** Cadence par défaut : tous les jours à 6h (surchargée par REVIEW_POLL_CRON). */
const DEFAULT_CRON = '0 6 * * *';

interface ReviewPollJobData {
  reason?: string;
}

let reviewQueue: Queue<ReviewPollJobData> | null = null;
let reviewWorker: Worker<ReviewPollJobData> | null = null;

function bullConnection(): ConnectionOptions {
  return getRedisConnection() as unknown as ConnectionOptions;
}

/**
 * Enregistre le scheduler de polling review : crée la queue, planifie le job
 * répétable (cron quotidien) et démarre le worker qui exécute pollReviews.
 * Idempotent. À appeler depuis index.ts.
 */
export async function startReviewScheduler(cron: string = process.env.REVIEW_POLL_CRON?.trim() || DEFAULT_CRON): Promise<void> {
  if (reviewWorker) return;

  reviewQueue = new Queue<ReviewPollJobData>(REVIEW_POLL_QUEUE, { connection: bullConnection() });
  reviewQueue.on('error', (err) => logger.error({ queue: REVIEW_POLL_QUEUE, err }, 'erreur queue review-poll'));

  // Job répétable (cron) — dédupliqué par jobId stable.
  await reviewQueue.add(
    REVIEW_POLL_JOB,
    { reason: 'cron' },
    { repeat: { pattern: cron }, jobId: REVIEW_POLL_JOB, removeOnComplete: 20, removeOnFail: 50 },
  );

  reviewWorker = new Worker<ReviewPollJobData>(
    REVIEW_POLL_QUEUE,
    async (_job: Job<ReviewPollJobData>) => {
      const outcomes = await pollReviews();
      return { polled: outcomes.length };
    },
    { connection: bullConnection(), concurrency: 1 },
  );
  reviewWorker.on('failed', (job, err) =>
    logger.error({ queue: REVIEW_POLL_QUEUE, jobId: job?.id, err }, 'review-poll : job en échec'),
  );
  reviewWorker.on('error', (err) => logger.error({ queue: REVIEW_POLL_QUEUE, err }, 'erreur worker review-poll'));

  logger.info({ cron }, 'scheduler review-poll démarré');
}

/** Déclenche un poll immédiat hors cadence (diagnostic / bouton admin). */
export async function triggerReviewPollNow(): Promise<void> {
  if (!reviewQueue) reviewQueue = new Queue<ReviewPollJobData>(REVIEW_POLL_QUEUE, { connection: bullConnection() });
  await reviewQueue.add(REVIEW_POLL_JOB + ':manual', { reason: 'manual' }, { removeOnComplete: true });
}

/** Arrête proprement le scheduler (worker + queue). */
export async function stopReviewScheduler(): Promise<void> {
  await reviewWorker?.close().catch(() => undefined);
  await reviewQueue?.close().catch(() => undefined);
  reviewWorker = null;
  reviewQueue = null;
}
