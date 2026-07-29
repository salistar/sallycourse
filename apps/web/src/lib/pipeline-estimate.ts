import { QUEUES, type QueueName } from '@sallycourse/shared';
import { connectDb, Lesson } from '@sallycourse/db';
import { averageStepDurationMs } from './queue-estimate';
import { queueConcurrency } from './queue-concurrency';

/**
 * Estimation du temps total du pipeline de génération d'un cours (P134) —
 * affichée AVANT lancement (contrairement à queue-estimate.ts qui estime
 * l'attente d'UNE queue une fois le job déjà en file). Somme des étapes :
 *   outline (1x) + content × N leçons + tts × N + video × N + subtitle × N.
 * N (nombre de leçons prévu) vient soit du plan déjà connu (Section/Lesson
 * persistées), soit d'une estimation par défaut si le plan n'existe pas encore
 * (avant génération de l'outline). packaging/deployment comptent pour 1 unité
 * chacun (non répétés par leçon). Toutes les durées moyennes viennent de
 * l'historique GenerationJob (averageStepDurationMs, P73) — best-effort :
 * une étape sans historique contribue 0 (l'estimation dégrade gracieusement
 * plutôt que d'échouer).
 */

/** Nombre de leçons par défaut utilisé quand le plan n'est pas encore connu. */
export const DEFAULT_ESTIMATED_LESSONS = 24;

/** Étapes répétées une fois par leçon (dans l'ordre du pipeline). */
const PER_LESSON_STEPS: readonly QueueName[] = [
  QUEUES.content,
  QUEUES.tts,
  QUEUES.screenshot,
  QUEUES.videoRender,
  QUEUES.subtitle,
];

/** Étapes exécutées une seule fois pour tout le cours. */
const PER_COURSE_STEPS: readonly QueueName[] = [QUEUES.outline, QUEUES.packaging];

export interface PipelineStepEstimate {
  queueName: QueueName;
  /** Nombre de répétitions de ce step dans le pipeline (1 pour les étapes par cours). */
  occurrences: number;
  /** Durée moyenne historique d'UNE occurrence, en ms (0 si aucun historique). */
  averageDurationMs: number;
  /** occurrences × averageDurationMs. */
  totalMs: number;
}

export interface PipelineEstimate {
  lessonCount: number;
  steps: PipelineStepEstimate[];
  /** Somme de toutes les étapes — durée totale estimée du pipeline, en ms. */
  totalMs: number;
}

/**
 * Calcul PUR : combine le nombre de leçons et une table de durées moyennes
 * par queue en une estimation totale du pipeline. Séparé de la lecture Mongo
 * pour rester testable sans DB/Redis.
 *
 * `concurrencyByQueue` (défaut {} = concurrency 1 partout, rétrocompatible) :
 * les étapes MÉDIA par leçon (tts/screenshot/videoRender/subtitle) ne sont
 * PAS chaînées entre elles comme le texte — dès qu'une leçon a son script,
 * son média part en parallèle des autres, borné par la concurrency de
 * chaque queue (audit qualité 2026-07-29 — voir queue-concurrency.ts). Le
 * texte (QUEUES.content) reste délibérément exclu de cette division même si
 * on passe sa concurrency : la chaîne séquentielle « une leçon enfile la
 * suivante » (P19, continuité pédagogique inter-leçons) borne son débit à 1
 * quel que soit le nombre de slots BullMQ disponibles pour CE cours.
 */
export function computePipelineEstimate(
  lessonCount: number,
  averageDurations: Readonly<Record<QueueName, number>>,
  concurrencyByQueue: Readonly<Partial<Record<QueueName, number>>> = {},
): PipelineEstimate {
  const steps: PipelineStepEstimate[] = [];

  for (const queueName of PER_COURSE_STEPS) {
    const averageDurationMs = averageDurations[queueName] ?? 0;
    steps.push({ queueName, occurrences: 1, averageDurationMs, totalMs: averageDurationMs });
  }
  for (const queueName of PER_LESSON_STEPS) {
    const averageDurationMs = averageDurations[queueName] ?? 0;
    const occurrences = Math.max(0, lessonCount);
    const concurrency = queueName === QUEUES.content ? 1 : Math.max(1, concurrencyByQueue[queueName] ?? 1);
    const totalMs = Math.ceil((occurrences * averageDurationMs) / concurrency);
    steps.push({ queueName, occurrences, averageDurationMs, totalMs });
  }

  const totalMs = steps.reduce((acc, s) => acc + s.totalMs, 0);
  return { lessonCount, steps, totalMs };
}

/** Toutes les queues intervenant dans le calcul du pipeline (ordre stable). */
const PIPELINE_QUEUES: readonly QueueName[] = [...PER_COURSE_STEPS, ...PER_LESSON_STEPS];

/**
 * Nombre de leçons prévu pour un cours : compte les Lesson déjà persistées
 * (plan déjà généré) ; sinon retombe sur DEFAULT_ESTIMATED_LESSONS (avant
 * génération de l'outline, on ne connaît pas encore le nombre exact).
 */
async function estimateLessonCount(courseId: string): Promise<number> {
  const count = await Lesson.countDocuments({ courseId }).catch(() => 0);
  return count > 0 ? count : DEFAULT_ESTIMATED_LESSONS;
}

/**
 * Estimation du temps total du pipeline pour un cours donné (P134) —
 * best-effort : toute indisponibilité Mongo renvoie une estimation à 0 pour
 * chaque step plutôt que de faire échouer l'écran de génération.
 */
export async function estimatePipelineDuration(courseId: string): Promise<PipelineEstimate> {
  await connectDb().catch(() => undefined);

  const lessonCount = await estimateLessonCount(courseId).catch(() => DEFAULT_ESTIMATED_LESSONS);

  const durations = await Promise.all(
    PIPELINE_QUEUES.map((q) => averageStepDurationMs(q).catch(() => 0)),
  );
  const averageDurations = Object.fromEntries(
    PIPELINE_QUEUES.map((q, i) => [q, durations[i]]),
  ) as Record<QueueName, number>;
  const concurrencyByQueue = Object.fromEntries(
    PIPELINE_QUEUES.map((q) => [q, queueConcurrency(q)]),
  ) as Record<QueueName, number>;

  return computePipelineEstimate(lessonCount, averageDurations, concurrencyByQueue);
}

/**
 * Formate un instant estimé « prêt vers HH:mm » (P134) : maintenant + durée
 * totale estimée du pipeline (+ éventuel délai d'attente en file / programmation
 * nocturne, additionné en amont par l'appelant). Calcul PUR — testable sans horloge système.
 */
export function computeReadyAt(now: Date, totalEstimatedMs: number): Date {
  return new Date(now.getTime() + Math.max(0, totalEstimatedMs));
}

/** Formate une Date en « HH:mm » (heure locale, deux chiffres). */
export function formatReadyAtLabel(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
