// Lecture des instantanés de circuit breakers (Prompt 77) depuis Redis.
// Miroir des clés écrites par apps/worker/src/lib/circuit-breaker.ts
// (circuit-breaker:<nom>, persistées à chaque transition d'état). Best-effort :
// Redis indisponible ou aucune clé encore écrite → liste vide (le dashboard
// reste utilisable, ce n'est pas une erreur — signifie « aucun incident »).
import { Redis } from 'ioredis';
import { getConfig } from '@sallycourse/shared';
import { logger } from '@/lib/logger';
import type { CircuitBreakerSnapshot } from './breaker-view';

const CIRCUIT_BREAKER_REDIS_PREFIX = 'circuit-breaker:';

interface Store {
  redis?: Redis;
}
const globalWithBreakerRedis = globalThis as typeof globalThis & { __sallycourseBreakerRedis?: Store };
const store: Store = (globalWithBreakerRedis.__sallycourseBreakerRedis ??= {});

function getRedis(): Redis {
  if (!store.redis) {
    store.redis = new Redis(getConfig().REDIS_URL, { maxRetriesPerRequest: null });
  }
  return store.redis;
}

/** Scanne toutes les clés circuit-breaker:* et parse leurs instantanés JSON (best-effort). */
export async function readCircuitBreakerSnapshots(): Promise<CircuitBreakerSnapshot[]> {
  try {
    const redis = getRedis();
    const keys = await redis.keys(`${CIRCUIT_BREAKER_REDIS_PREFIX}*`);
    if (keys.length === 0) return [];
    const values = await redis.mget(...keys);
    const out: CircuitBreakerSnapshot[] = [];
    for (const raw of values) {
      if (!raw) continue;
      try {
        out.push(JSON.parse(raw) as CircuitBreakerSnapshot);
      } catch (err) {
        logger.warn({ err }, 'circuit-breakers admin : instantané corrompu ignoré');
      }
    }
    return out;
  } catch (err) {
    // Page justement dédiée à la résilience : un Redis injoignable doit être
    // visible dans les logs serveur, même si l'UI retombe sur liste vide.
    logger.warn({ err }, 'circuit-breakers admin : lecture Redis impossible');
    return [];
  }
}
