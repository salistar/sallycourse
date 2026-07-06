// Connexion Redis partagée du worker (BullMQ exige maxRetriesPerRequest: null).
import { Redis } from 'ioredis';
import { getConfig } from '../shared.js';

let sharedConnection: Redis | null = null;

/** Connexion Redis partagée (queues, workers, heartbeat). Singleton lazy. */
export function getRedisConnection(): Redis {
  if (!sharedConnection) {
    sharedConnection = new Redis(getConfig().REDIS_URL, {
      maxRetriesPerRequest: null, // requis par les Workers BullMQ
      enableReadyCheck: false,
    });
  }
  return sharedConnection;
}

/** Client Redis dédié (ex : mode subscribe, qui bloque la connexion). */
export function createRedisClient(): Redis {
  return new Redis(getConfig().REDIS_URL, { maxRetriesPerRequest: null });
}

/** Ferme proprement la connexion partagée (arrêt du worker). */
export async function closeSharedRedis(): Promise<void> {
  if (!sharedConnection) return;
  const conn = sharedConnection;
  sharedConnection = null;
  try {
    await conn.quit();
  } catch {
    conn.disconnect();
  }
}
