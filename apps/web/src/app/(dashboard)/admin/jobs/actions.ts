'use server';

import { revalidatePath } from 'next/cache';
import { Queue, type ConnectionOptions } from 'bullmq';
import Redis from 'ioredis';
import { Types } from 'mongoose';
import { connectDb, GenerationJob, type GenerationJobDocument } from '@sallycourse/db';
import {
  QUEUE_NAMES,
  defaultJobOptions,
  getConfig,
  makeJobId,
  type QueueName,
} from '@sallycourse/shared';
import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';

/**
 * Actions serveur de la page admin des jobs : relance d'un job échoué
 * (ré-enqueue BullMQ avec jobId déterministe + remise en pending côté Mongo)
 * et relance en masse de tous les échoués.
 */

// NB : un fichier 'use server' ne peut exporter que des fonctions async —
// le filtre des échoués est dupliqué localement (voir aussi page.tsx).
const FAILED_FILTER = { error: { $exists: true, $nin: [null, ''] } } as const;

/** Garde : seuls les admins peuvent déclencher ces actions. */
async function requireAdmin(): Promise<void> {
  const session = await auth();
  if (session?.user?.role !== 'admin') {
    throw new Error('Accès réservé aux administrateurs.');
  }
}

// ── Connexion BullMQ partagée (globalThis : survit au HMR en dev) ──
const globalForQueues = globalThis as unknown as {
  __bullConnection?: Redis;
  __bullQueues?: Map<QueueName, Queue>;
};

function getBullConnection(): Redis {
  if (!globalForQueues.__bullConnection) {
    // maxRetriesPerRequest: null — exigé par BullMQ.
    globalForQueues.__bullConnection = new Redis(getConfig().REDIS_URL, {
      maxRetriesPerRequest: null,
    });
    globalForQueues.__bullConnection.on('error', () => {});
  }
  return globalForQueues.__bullConnection;
}

function getQueue(name: QueueName): Queue {
  globalForQueues.__bullQueues ??= new Map();
  let queue = globalForQueues.__bullQueues.get(name);
  if (!queue) {
    // Cast : pnpm résout deux versions d'ioredis (celle du web vs celle
    // embarquée par bullmq) — types structurellement identiques à l'exécution.
    queue = new Queue(name, { connection: getBullConnection() as unknown as ConnectionOptions });
    globalForQueues.__bullQueues.set(name, queue);
  }
  return queue;
}

function isQueueName(step: string): step is QueueName {
  return (QUEUE_NAMES as readonly string[]).includes(step);
}

/**
 * Ré-enqueue le step d'un job : supprime l'éventuel job BullMQ résiduel
 * (même jobId déterministe, sinon la déduplication bloquerait l'ajout),
 * poste un job neuf et remet le document Mongo en pending.
 */
async function requeueJob(job: GenerationJobDocument): Promise<void> {
  if (!isQueueName(job.step)) {
    throw new Error(`Étape inconnue, impossible de relancer : "${job.step}".`);
  }

  const courseId = job.courseId.toString();
  const queue = getQueue(job.step);
  const bullId = makeJobId(courseId, job.step);

  try {
    const existing = await queue.getJob(bullId);
    if (existing) await existing.remove();
  } catch {
    // Job actif ou déjà retiré : l'ajout ci-dessous dédupliquera si besoin.
  }

  await queue.add(job.step, { courseId }, { ...defaultJobOptions, jobId: bullId });

  // Remise en pending côté Mongo : progression 0, erreur effacée, trace.
  job.progress = 0;
  job.error = undefined;
  job.logs.push({ ts: new Date(), level: 'info', msg: 'Relance manuelle (admin)' });
  await job.save();

  logger.info({ jobId: job._id.toString(), step: job.step, courseId }, 'job relancé par un admin');
}

/** Relance un job précis (bouton « Relancer »). */
export async function retryJobAction(jobId: string): Promise<void> {
  await requireAdmin();
  if (!Types.ObjectId.isValid(jobId)) throw new Error('Identifiant de job invalide.');

  await connectDb();
  const job = await GenerationJob.findById(jobId);
  if (!job) throw new Error('Job introuvable.');

  await requeueJob(job);
  revalidatePath('/admin/jobs');
}

/** Relance tous les jobs échoués (bouton « Relancer tous les échoués »). */
export async function retryAllFailedAction(): Promise<void> {
  await requireAdmin();
  await connectDb();

  const failed = await GenerationJob.find(FAILED_FILTER);
  let relaunched = 0;
  for (const job of failed) {
    try {
      await requeueJob(job);
      relaunched += 1;
    } catch (err) {
      // Un step illisible ne doit pas bloquer la relance des autres.
      logger.error({ jobId: job._id.toString(), err: err instanceof Error ? err.message : String(err) }, 'relance échouée');
    }
  }

  logger.info({ relaunched, total: failed.length }, 'relance en masse des jobs échoués');
  revalidatePath('/admin/jobs');
}
