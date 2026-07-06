import { isValidObjectId } from 'mongoose';
import Redis from 'ioredis';
import { connectDb, Course, GenerationJob } from '@sallycourse/db';
import { getConfig, subscribeProgress, type ProgressEvent } from '@sallycourse/shared';
import { requireApiUser } from '@/lib/session';

// SSE = flux long : runtime Node obligatoire, jamais de cache.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Intervalle du ping keepalive (proxys/navigateurs coupent les flux muets). */
const KEEPALIVE_MS = 25_000;

/**
 * GET /api/courses/[id]/progress — progression de génération en temps réel.
 * Server-Sent Events : snapshot initial (GenerationJob) puis relais du canal
 * Redis PROGRESS_CHANNEL(courseId), avec ping toutes les 25 s.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return Response.json({ error: 'Cours introuvable.' }, { status: 404 });
  }

  await connectDb();

  // Ownership : le cours doit appartenir à l'utilisateur connecté.
  const course = await Course.findOne({ _id: id, userId: user.id }).select('_id').lean();
  if (!course) {
    return Response.json({ error: 'Cours introuvable.' }, { status: 404 });
  }

  // Snapshot initial : dernier état connu du job de génération.
  const job = await GenerationJob.findOne({ courseId: id }).sort({ updatedAt: -1 }).lean();

  // Connexion Redis DÉDIÉE au mode subscribe (exigence ioredis), fermée à l'abort.
  const subscriber = new Redis(getConfig().REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  const encoder = new TextEncoder();
  let closed = false;
  let keepalive: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => Promise<void>) | undefined;

  /** Libère toutes les ressources (idempotent). */
  const cleanup = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    if (keepalive) clearInterval(keepalive);
    try {
      await unsubscribe?.();
    } catch {
      // Désabonnement best-effort : la connexion est fermée juste après.
    }
    subscriber.disconnect();
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Le client a coupé entre le check et l'enqueue : on nettoie.
          void cleanup();
        }
      };
      const sendData = (payload: unknown): void => {
        send(`data: ${JSON.stringify(payload)}\n\n`);
      };

      // Fermeture propre quand le client coupe la requête.
      request.signal.addEventListener('abort', () => {
        void cleanup();
        try {
          controller.close();
        } catch {
          // Déjà fermé.
        }
      });

      // 1) Snapshot initial depuis GenerationJob (logs inclus).
      if (job) {
        sendData({
          type: 'snapshot',
          courseId: id,
          step: job.step,
          progress: job.progress,
          error: job.error ?? null,
          logs: job.logs.map((l) => ({
            ts: new Date(l.ts).getTime(),
            level: l.level,
            msg: l.msg,
          })),
          ts: new Date(job.updatedAt).getTime(),
        });
      }

      // 2) Relais temps réel du canal Redis pub/sub du cours.
      try {
        unsubscribe = await subscribeProgress(subscriber, id, (event: ProgressEvent) => {
          sendData(event);
        });
      } catch {
        // Redis indisponible : on signale puis on ferme le flux.
        sendData({ type: 'error', message: 'Flux de progression indisponible.', ts: Date.now() });
        void cleanup();
        try {
          controller.close();
        } catch {
          // Déjà fermé.
        }
        return;
      }

      // 3) Ping keepalive (commentaire SSE, ignoré par EventSource).
      keepalive = setInterval(() => send(': keepalive\n\n'), KEEPALIVE_MS);
    },
    cancel() {
      void cleanup();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Désactive le buffering des proxys type nginx.
      'X-Accel-Buffering': 'no',
    },
  });
}
