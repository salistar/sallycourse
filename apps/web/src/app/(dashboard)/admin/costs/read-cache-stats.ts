// Lecture des compteurs bruts du cache intelligent (Prompt 72) depuis Redis.
// Miroir des clés écrites par apps/worker/src/lib/cache.ts (cache:stats:<ns>:hit|miss).
// Best-effort : Redis indisponible → compteurs à zéro (le dashboard reste utilisable).
import { Redis } from 'ioredis';
import { getConfig } from '@sallycourse/shared';
import type { CacheNamespace, CacheNamespaceCounts } from './cache-stats';

const STATS_PREFIX = 'cache:stats:';
const NAMESPACES: CacheNamespace[] = ['claude', 'tts', 'screenshot'];

interface Store {
  redis?: Redis;
}
const globalWithCacheRedis = globalThis as typeof globalThis & { __sallycourseCacheRedis?: Store };
const store: Store = (globalWithCacheRedis.__sallycourseCacheRedis ??= {});

function getRedis(): Redis {
  if (!store.redis) {
    store.redis = new Redis(getConfig().REDIS_URL, { maxRetriesPerRequest: null });
  }
  return store.redis;
}

/** Lit les compteurs hit/miss de chaque namespace de cache (best-effort). */
export async function readCacheCounts(): Promise<CacheNamespaceCounts[]> {
  const redis = getRedis();
  const out: CacheNamespaceCounts[] = [];
  for (const namespace of NAMESPACES) {
    try {
      const [hits, misses] = await Promise.all([
        redis.get(`${STATS_PREFIX}${namespace}:hit`),
        redis.get(`${STATS_PREFIX}${namespace}:miss`),
      ]);
      out.push({ namespace, hits: Number(hits ?? 0), misses: Number(misses ?? 0) });
    } catch {
      out.push({ namespace, hits: 0, misses: 0 });
    }
  }
  return out;
}
