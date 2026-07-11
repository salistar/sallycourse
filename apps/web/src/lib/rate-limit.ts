import { Redis } from 'ioredis';
import { getConfig } from '@sallycourse/shared';

/**
 * Rate limiting & anti-abus (P70) — sliding window sur Redis (ioredis, sans
 * dépendance externe type rate-limiter-flexible). Une connexion dédiée est
 * utilisée (distincte de celle de lib/queues.ts) car les commandes ici sont
 * synchrones/rapides (ZADD/ZCARD) et ne doivent pas partager la config
 * `maxRetriesPerRequest: null` pensée pour BullMQ.
 */

interface RateLimitStore {
  redis?: Redis;
}

const globalWithRateLimit = globalThis as typeof globalThis & {
  __sallycourseRateLimit?: RateLimitStore;
};

const store: RateLimitStore = (globalWithRateLimit.__sallycourseRateLimit ??= {});

function getRedis(): Redis {
  if (!store.redis) {
    store.redis = new Redis(getConfig().REDIS_URL);
  }
  return store.redis;
}

/** Réinitialise la connexion (tests uniquement). */
export function resetRateLimitRedisForTests(): void {
  store.redis = undefined;
}

export interface RateLimitOptions {
  /** Nombre maximal de requêtes autorisées dans la fenêtre. */
  limit: number;
  /** Taille de la fenêtre glissante, en secondes. */
  windowSec: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Requêtes restantes dans la fenêtre courante (0 si limite atteinte). */
  remaining: number;
  /** Instant auquel la fenêtre courante sera entièrement expirée. */
  resetAt: Date;
}

/**
 * Sliding window log via ZSET Redis : chaque requête est un membre horodaté
 * (score = timestamp ms), les entrées plus vieilles que la fenêtre sont
 * purgées avant comptage. Atomique via un script Lua unique (EVAL) pour
 * résister aux appels concurrents (pas de lecture-puis-écriture séparée).
 *
 * clé Redis : `ratelimit:{key}`. Chaque appelant compose sa propre `key`
 * (ex: `courses:ip:1.2.3.4`, `courses:user:<id>`, `register:ip:...`).
 */
const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - windowMs)
local count = redis.call('ZCARD', key)

if count < limit then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, windowMs)
  return count + 1
else
  return -1
end
`;

export async function rateLimit(key: string, options: RateLimitOptions): Promise<RateLimitResult> {
  const { limit, windowSec } = options;
  const windowMs = windowSec * 1000;
  const now = Date.now();
  const redis = getRedis();
  const redisKey = `ratelimit:${key}`;
  // Membre unique par requête : évite les collisions de score entre deux
  // appels au même timestamp exact.
  const member = `${now}:${Math.random().toString(36).slice(2)}`;

  const result = await redis.eval(
    SLIDING_WINDOW_SCRIPT,
    1,
    redisKey,
    String(now),
    String(windowMs),
    String(limit),
    member,
  );

  const used = typeof result === 'number' ? result : Number(result);
  const resetAt = new Date(now + windowMs);

  if (used < 0) {
    return { allowed: false, remaining: 0, resetAt };
  }
  return { allowed: true, remaining: Math.max(0, limit - used), resetAt };
}

// ── Lockout progressif (anti-bruteforce login) ──────────────────
/**
 * Compteur d'échecs par clé (IP+email) avec délai de verrouillage croissant.
 * Paliers : 3 échecs → 30s, 5 → 2min, 8 → 10min, 12+ → 30min. Le compteur
 * expire après 1h d'inactivité (pas de purge manuelle nécessaire).
 */
const LOCKOUT_TIERS: readonly { attempts: number; delaySec: number }[] = [
  { attempts: 12, delaySec: 1800 },
  { attempts: 8, delaySec: 600 },
  { attempts: 5, delaySec: 120 },
  { attempts: 3, delaySec: 30 },
];

const LOCKOUT_COUNTER_TTL_SEC = 3600;

function delayForAttempts(attempts: number): number {
  for (const tier of LOCKOUT_TIERS) {
    if (attempts >= tier.attempts) return tier.delaySec;
  }
  return 0;
}

export interface LockoutState {
  /** True si l'appelant doit être bloqué maintenant. */
  locked: boolean;
  /** Secondes restantes avant la prochaine tentative autorisée. */
  retryAfterSec: number;
  /** Nombre d'échecs comptabilisés dans la fenêtre active. */
  attempts: number;
}

function lockoutKey(ipEmail: string): string {
  return `lockout:${ipEmail}`;
}

/**
 * Vérifie l'état de verrouillage SANS enregistrer de tentative (appelé avant
 * authorize()). Lit à la fois le compteur d'échecs et l'horodatage du dernier
 * échec pour dériver si le délai du palier courant est encore actif.
 */
export async function checkLoginLockout(ipEmail: string): Promise<LockoutState> {
  const redis = getRedis();
  const key = lockoutKey(ipEmail);
  const [attemptsRaw, lastFailureRaw] = await redis.hmget(key, 'attempts', 'lastFailureAt');
  const attempts = Number(attemptsRaw ?? 0);
  const lastFailureAt = Number(lastFailureRaw ?? 0);

  if (attempts === 0) return { locked: false, retryAfterSec: 0, attempts: 0 };

  const delaySec = delayForAttempts(attempts);
  if (delaySec === 0) return { locked: false, retryAfterSec: 0, attempts };

  const elapsedSec = (Date.now() - lastFailureAt) / 1000;
  const remaining = delaySec - elapsedSec;
  if (remaining <= 0) return { locked: false, retryAfterSec: 0, attempts };

  return { locked: true, retryAfterSec: Math.ceil(remaining), attempts };
}

/** Enregistre un échec de connexion et retourne le nouvel état de verrouillage. */
export async function recordLoginFailure(ipEmail: string): Promise<LockoutState> {
  const redis = getRedis();
  const key = lockoutKey(ipEmail);
  const now = Date.now();

  const attempts = await redis.hincrby(key, 'attempts', 1);
  await redis.hset(key, 'lastFailureAt', now);
  await redis.expire(key, LOCKOUT_COUNTER_TTL_SEC);

  const delaySec = delayForAttempts(attempts);
  return { locked: delaySec > 0, retryAfterSec: delaySec, attempts };
}

/** Remet à zéro le compteur d'échecs (connexion réussie). */
export async function clearLoginLockout(ipEmail: string): Promise<void> {
  const redis = getRedis();
  await redis.del(lockoutKey(ipEmail));
}

/** Extrait une IP plausible des en-têtes de la requête (proxy/CDN en amont). */
export function extractClientIp(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) return forwardedFor.split(',')[0]!.trim();
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return 'unknown';
}
