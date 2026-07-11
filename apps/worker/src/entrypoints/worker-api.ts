// Entrypoint dédié charge API (P71 — scaling) : Claude (outline/content) + TTS/subtitle.
// Ne démarre QUE les queues du groupe API (registerApiQueues) — dérivé de index.ts
// mais sans les processors CPU/Playwright. Voir README-scaling.md pour le déploiement k3s.
import mongoose from 'mongoose';
import { connectDb, getConfig } from '../shared.js';
import { closeAll, logger, startHeartbeat } from '../queues/index.js';
import { registerApiQueues } from './register-groups.js';

async function main(): Promise<void> {
  const config = getConfig();
  await connectDb(config.MONGO_URI);
  logger.info({ env: config.NODE_ENV, entrypoint: 'worker-api' }, 'worker SallyCourse (API) : Mongo connecté');

  const queues = registerApiQueues();
  logger.info({ queues }, 'queues API initialisées');

  startHeartbeat();
}

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal, entrypoint: 'worker-api' }, 'arrêt du worker API demandé');
  try {
    await closeAll();
    await mongoose.disconnect();
    logger.info('arrêt propre terminé (worker-api)');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, "erreur pendant l'arrêt (worker-api)");
    process.exit(1);
  }
}

process.on('SIGTERM', (signal) => void shutdown(signal));
process.on('SIGINT', (signal) => void shutdown(signal));

main().catch((err) => {
  logger.error({ err }, 'démarrage du worker API impossible');
  process.exit(1);
});
