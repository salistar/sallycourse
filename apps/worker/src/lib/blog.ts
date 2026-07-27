// Blog SEO — publication étalée (Prompt 204). Même patron que le scheduler des
// séquences email (lib/email-sequence.ts) : une queue BullMQ dédiée (hors
// registre typé) portant DEUX natures de jobs :
//
//  - job répétable (cron horaire) : publie les articles arrivés à échéance
//    (BlogPost.status='scheduled' et scheduledFor <= now) — la sélection est
//    faite par la logique PURE selectDueBlogPosts (@sallycourse/shared/blog) ;
//  - job ponctuel { courseId } : génère (ou régénère) le blog d'un cours —
//    enfilé à la PUBLICATION du cours par l'adapter LMS, ou par le bouton
//    « Régénérer » du tableau de bord (POST /api/courses/[id]/blog).
//
// Best-effort de bout en bout : un échec de génération ne casse jamais la
// publication du cours, un échec de publication d'article est retenté au
// passage suivant.
import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import { BlogPost, selectDueBlogPosts } from '../shared.js';
import { getRedisConnection } from '../queues/connection.js';
import { logger } from '../queues/index.js';
import { generateCourseBlog } from '../generators/blog.js';

/** Queue cron dédiée au blog SEO (hors registre typé, comme email-sequence). */
export const BLOG_QUEUE = 'blog-seo';
/** Identifiant du job répétable (dédupliqué par BullMQ). */
export const BLOG_PUBLISH_JOB = 'blog-publish-due-hourly';
/** Nom du job ponctuel de (re)génération du blog d'un cours. */
export const BLOG_GENERATE_JOB = 'blog-generate-course';
/** Cadence par défaut du passage de publication (surchargée par BLOG_CRON). */
const DEFAULT_CRON = '0 * * * *';
/** Nombre max d'articles publiés par passage (borne la charge). */
const MAX_POSTS_PER_RUN = 200;

export interface BlogJobData {
  /** Présent → (re)génération du blog de ce cours ; absent → passage de publication. */
  courseId?: string;
  reason?: string;
}

let blogQueue: Queue<BlogJobData> | null = null;
let blogWorker: Worker<BlogJobData> | null = null;

function bullConnection(): ConnectionOptions {
  return getRedisConnection() as unknown as ConnectionOptions;
}

/** Queue paresseuse (créée à la première utilisation, réutilisée ensuite). */
function queue(): Queue<BlogJobData> {
  if (!blogQueue) {
    blogQueue = new Queue<BlogJobData>(BLOG_QUEUE, { connection: bullConnection() });
    blogQueue.on('error', (err) => logger.error({ queue: BLOG_QUEUE, err }, 'erreur queue blog'));
  }
  return blogQueue;
}

/**
 * Publie les articles programmés dont l'échéance est atteinte : status
 * 'published' + publishedAt. Best-effort par article — un échec n'interrompt
 * pas les suivants (l'article reste 'scheduled' et sera retenté).
 */
export async function publishDueBlogPosts(now: Date = new Date()): Promise<{ published: number; failed: number }> {
  const candidates = await BlogPost.find({ status: 'scheduled', scheduledFor: { $lte: now } })
    .select('_id status scheduledFor slug')
    .limit(MAX_POSTS_PER_RUN)
    .lean();

  // Filtrage PUR (même règle que le calcul du calendrier) — la requête Mongo
  // n'est qu'une pré-sélection indexée.
  const due = selectDueBlogPosts(
    candidates.map((p) => ({ id: String(p._id), status: p.status, scheduledFor: p.scheduledFor, slug: p.slug })),
    now,
  );

  let published = 0;
  let failed = 0;
  for (const post of due) {
    try {
      await BlogPost.updateOne(
        { _id: post.id, status: 'scheduled' },
        { $set: { status: 'published', publishedAt: now } },
      );
      published += 1;
    } catch (err) {
      failed += 1;
      logger.warn({ slug: post.slug, err }, 'blog : publication d’un article échouée, réessai au prochain passage');
    }
  }

  if (published || failed) logger.info({ published, failed }, 'blog : passage de publication terminé');
  return { published, failed };
}

/**
 * Enfile la (re)génération du blog d'un cours. Best-effort : ne jette JAMAIS —
 * appelé depuis la publication du cours (adapter LMS), qui ne doit pas échouer
 * si Redis est momentanément indisponible.
 */
export async function enqueueBlogGeneration(courseId: string, reason = 'course-published'): Promise<boolean> {
  try {
    await queue().add(
      BLOG_GENERATE_JOB,
      { courseId, reason },
      // jobId déterministe : deux publications rapprochées du même cours ne
      // lancent pas deux générations concurrentes.
      { jobId: `${BLOG_GENERATE_JOB}_${courseId}`, removeOnComplete: 20, removeOnFail: 50 },
    );
    return true;
  } catch (err) {
    logger.warn({ courseId, err }, 'blog : mise en file de la génération impossible (ignoré)');
    return false;
  }
}

/**
 * Démarre le scheduler du blog : queue, job répétable (cron horaire) et worker
 * qui traite les deux natures de jobs. Idempotent. À appeler depuis index.ts.
 */
export async function startBlogScheduler(
  cron: string = process.env.BLOG_CRON?.trim() || DEFAULT_CRON,
): Promise<void> {
  if (blogWorker) return;

  await queue().add(
    BLOG_PUBLISH_JOB,
    { reason: 'cron' },
    { repeat: { pattern: cron }, jobId: BLOG_PUBLISH_JOB, removeOnComplete: 20, removeOnFail: 50 },
  );

  blogWorker = new Worker<BlogJobData>(
    BLOG_QUEUE,
    async (job: Job<BlogJobData>) => {
      if (job.data.courseId) {
        await generateCourseBlog({ courseId: job.data.courseId });
        // Les articles dont l'échéance est déjà passée sont créés 'published' par
        // le générateur : rien à publier en plus ici.
        return;
      }
      await publishDueBlogPosts();
    },
    { connection: bullConnection(), concurrency: 1 },
  );
  blogWorker.on('failed', (job, err) =>
    logger.error({ queue: BLOG_QUEUE, jobId: job?.id, err }, 'blog : job en échec'),
  );
  blogWorker.on('error', (err) => logger.error({ queue: BLOG_QUEUE, err }, 'erreur worker blog'));

  logger.info({ cron }, 'scheduler blog SEO démarré');
}

/** Arrête proprement le scheduler (worker + queue). */
export async function stopBlogScheduler(): Promise<void> {
  await blogWorker?.close().catch(() => undefined);
  await blogQueue?.close().catch(() => undefined);
  blogWorker = null;
  blogQueue = null;
}
