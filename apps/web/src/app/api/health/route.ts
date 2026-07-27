import { NextResponse } from 'next/server';
import Redis from 'ioredis';
import { connectDb } from '@sallycourse/db';
import { checkStorage, getConfig } from '@sallycourse/shared';
import { logger } from '@/lib/logger';

/**
 * GET /api/health — endpoint public (exclu du middleware d'auth).
 * Vérifie Mongo (ping), Redis (ping), MinIO (HeadBucket) et le heartbeat du
 * worker (clé Redis `worker:heartbeat` datant de moins de 60 s).
 * Réponse : { status: 'ok' | 'degraded', checks, ts } — 200 ou 503.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CHECK_TIMEOUT_MS = 3_000;
const HEARTBEAT_KEY = 'worker:heartbeat';
const HEARTBEAT_MAX_AGE_MS = 60_000;

interface CheckResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

/** Client Redis partagé (survit au HMR en dev via globalThis). */
const globalForHealth = globalThis as unknown as { __healthRedis?: Redis };

function getRedis(): Redis {
  if (!globalForHealth.__healthRedis) {
    globalForHealth.__healthRedis = new Redis(getConfig().REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: CHECK_TIMEOUT_MS,
    });
    // Évite les "Unhandled error event" quand Redis est indisponible.
    globalForHealth.__healthRedis.on('error', () => {});
  }
  return globalForHealth.__healthRedis;
}

/** Borne un check dans le temps pour ne jamais bloquer la réponse. */
function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} : délai dépassé (${CHECK_TIMEOUT_MS} ms)`)), CHECK_TIMEOUT_MS);
    }),
  ]);
}

/** Exécute un check en capturant l'erreur et la latence. */
async function runCheck(label: string, fn: () => Promise<void>): Promise<CheckResult> {
  const start = Date.now();
  try {
    await withTimeout(fn(), label);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, latencyMs: Date.now() - start, error: message };
  }
}

async function checkMongo(): Promise<void> {
  const m = await connectDb();
  const db = m.connection.db;
  if (!db) throw new Error('connexion Mongo sans base');
  await db.admin().command({ ping: 1 });
}

async function checkRedis(): Promise<void> {
  await getRedis().ping();
}

/**
 * Heartbeat du worker : bug trouvé lors du balayage de routes (2026-07-26) —
 * cette fonction lisait la clé LITTÉRALE `worker:heartbeat`, qui n'a jamais
 * existé : le worker écrit une clé PAR INSTANCE (`worker:heartbeat:{host}:
 * {pid}`, voir apps/worker/src/queues/index.ts startHeartbeat) et publie sur
 * le CANAL pub/sub `worker:heartbeat` (non lisible par GET). Résultat :
 * /api/health répondait TOUJOURS 503 « aucun heartbeat worker », même worker
 * parfaitement sain. Fix : scanner le pattern par instance et prendre le plus
 * récent.
 */
async function checkWorkerHeartbeat(): Promise<void> {
  const keys = await getRedis().keys(`${HEARTBEAT_KEY}:*`);
  if (keys.length === 0) throw new Error('aucun heartbeat worker');
  const values = await getRedis().mget(...keys);
  let freshest = -Infinity;
  for (const raw of values) {
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as { ts?: number };
      if (Number.isFinite(parsed.ts)) freshest = Math.max(freshest, parsed.ts!);
    } catch {
      /* clé illisible — ignorée, une autre instance peut être valide */
    }
  }
  if (!Number.isFinite(freshest)) throw new Error('heartbeat illisible');
  const ageMs = Date.now() - freshest;
  if (ageMs > HEARTBEAT_MAX_AGE_MS) {
    throw new Error(`heartbeat trop ancien (${Math.round(ageMs / 1000)} s)`);
  }
}

export async function GET(): Promise<NextResponse> {
  // Config invalide (env incomplet) : on répond degraded plutôt que 500.
  try {
    getConfig();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message }, 'healthcheck : configuration invalide');
    return NextResponse.json(
      { status: 'degraded', checks: { config: { ok: false, error: message } }, ts: new Date().toISOString() },
      { status: 503 },
    );
  }

  const [mongo, redis, storage, worker] = await Promise.all([
    runCheck('mongo', checkMongo),
    runCheck('redis', checkRedis),
    runCheck('storage', () => checkStorage()),
    runCheck('worker', checkWorkerHeartbeat),
  ]);

  const checks = { mongo, redis, storage, worker };
  const healthy = Object.values(checks).every((c) => c.ok);

  if (!healthy) logger.warn({ checks }, 'healthcheck dégradé');

  return NextResponse.json(
    { status: healthy ? 'ok' : 'degraded', checks, ts: new Date().toISOString() },
    { status: healthy ? 200 : 503 },
  );
}
