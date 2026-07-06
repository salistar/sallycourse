// Point d'entrée du worker BullMQ — branche l'infrastructure de queues.
// Les processors métier (outline, contenu, TTS, …) seront enregistrés ici
// via registerWorker(QUEUES.xxx, processor) au fil des prompts suivants.
import mongoose from 'mongoose';
import { connectDb, getConfig, QUEUES, QUEUE_NAMES } from './shared.js';
import { closeAll, createQueue, logger, registerWorker, startHeartbeat } from './queues/index.js';
import { processOutlineGeneration } from './processors/outline-generation.js';
import { processContentGeneration } from './processors/content-generation.js';

async function main(): Promise<void> {
  const config = getConfig();
  await connectDb(config.MONGO_URI);
  logger.info({ env: config.NODE_ENV }, 'worker SallyCourse : Mongo connecté');

  // Instancie les queues du pipeline (registre chaud, connexion Redis partagée).
  for (const name of QUEUE_NAMES) createQueue(name);
  logger.info({ queues: QUEUE_NAMES }, 'queues initialisées');

  // Processors métier (les étapes suivantes ajouteront les leurs ici).
  registerWorker(QUEUES.outline, processOutlineGeneration, { concurrency: 2 });
  registerWorker(QUEUES.content, processContentGeneration, { concurrency: 3 });

  startHeartbeat();
}

let shuttingDown = false;

/** Arrêt propre : workers → queues → Redis → Mongo, puis exit. */
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'arrêt du worker demandé');
  try {
    await closeAll();
    await mongoose.disconnect();
    logger.info('arrêt propre terminé');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, "erreur pendant l'arrêt");
    process.exit(1);
  }
}

process.on('SIGTERM', (signal) => void shutdown(signal));
process.on('SIGINT', (signal) => void shutdown(signal));

main().catch((err) => {
  logger.error({ err }, 'démarrage du worker impossible');
  process.exit(1);
});
