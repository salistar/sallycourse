// Entrypoint dédié charge Browser (P71 — scaling) : Playwright (déploiement plateformes).
// Ne démarre QUE la queue du groupe Browser (registerBrowserQueues) — 1 session
// navigateur par compte plateforme, concurrency basse par défaut (voir register-groups.ts).
// Dérivé de index.ts mais sans les processors CPU/API. Voir README-scaling.md (k3s).
import mongoose from 'mongoose';
import { connectDb, getConfig } from '../shared.js';
import { closeAll, logger, startHeartbeat } from '../queues/index.js';
import { registerBrowserQueues } from './register-groups.js';
// Import à effet de bord : enregistre les adapters de déploiement dans le registre.
import '../deploy/adapters/udemy.js';
import '../deploy/adapters/podia.js';
import '../deploy/adapters/gumroad.js';
import '../deploy/adapters/skillshare.js';
import '../deploy/adapters/lms.js';
import '../deploy/adapters/youtube.js';
import '../deploy/adapters/moodle.js';
import '../deploy/adapters/teachable.js';
import '../deploy/adapters/thinkific.js';
import { startReviewScheduler, stopReviewScheduler } from '../deploy/review-poll.js';

async function main(): Promise<void> {
  const config = getConfig();
  await connectDb(config.MONGO_URI);
  logger.info({ env: config.NODE_ENV, entrypoint: 'worker-browser' }, 'worker SallyCourse (Browser) : Mongo connecté');

  const queues = registerBrowserQueues();
  logger.info({ queues }, 'queues Browser initialisées');

  startHeartbeat();

  // Cron review & alerting (P47) : dépend des déploiements, colocalisé ici.
  await startReviewScheduler();
}

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal, entrypoint: 'worker-browser' }, 'arrêt du worker Browser demandé');
  try {
    await stopReviewScheduler();
    await closeAll();
    await mongoose.disconnect();
    logger.info('arrêt propre terminé (worker-browser)');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, "erreur pendant l'arrêt (worker-browser)");
    process.exit(1);
  }
}

process.on('SIGTERM', (signal) => void shutdown(signal));
process.on('SIGINT', (signal) => void shutdown(signal));

main().catch((err) => {
  logger.error({ err }, 'démarrage du worker Browser impossible');
  process.exit(1);
});
