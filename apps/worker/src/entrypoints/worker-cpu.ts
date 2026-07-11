// Entrypoint dédié charge CPU (P71 — scaling) : ffmpeg/rendu/packaging/screenshot.
// Ne démarre QUE les queues du groupe CPU (registerCpuQueues) — dérivé de index.ts
// mais sans les processors API/Playwright. Voir README-scaling.md pour le déploiement k3s.
import mongoose from 'mongoose';
import { connectDb, getConfig } from '../shared.js';
import { closeAll, logger, startHeartbeat } from '../queues/index.js';
import { registerCpuQueues } from './register-groups.js';
import { closeSlideBrowser } from '../media/slide-renderer.js';
import { killTpContainersOlderThan } from '../media/tp-environments.js';

/** Reaper des conteneurs TP orphelins (P22), pertinent ici : le rendu vidéo en dépend. */
const TP_REAPER_INTERVAL_MS = 15 * 60 * 1_000;
let tpReaperTimer: NodeJS.Timeout | null = null;

function startTpReaper(): void {
  if (tpReaperTimer) return;
  void killTpContainersOlderThan().catch(() => undefined);
  tpReaperTimer = setInterval(() => void killTpContainersOlderThan().catch(() => undefined), TP_REAPER_INTERVAL_MS);
  tpReaperTimer.unref();
}

function stopTpReaper(): void {
  if (tpReaperTimer) {
    clearInterval(tpReaperTimer);
    tpReaperTimer = null;
  }
}

async function main(): Promise<void> {
  const config = getConfig();
  await connectDb(config.MONGO_URI);
  logger.info({ env: config.NODE_ENV, entrypoint: 'worker-cpu' }, 'worker SallyCourse (CPU) : Mongo connecté');

  const queues = registerCpuQueues();
  logger.info({ queues }, 'queues CPU initialisées');

  startHeartbeat();
  startTpReaper();
}

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal, entrypoint: 'worker-cpu' }, 'arrêt du worker CPU demandé');
  try {
    stopTpReaper();
    await closeAll();
    await closeSlideBrowser();
    await mongoose.disconnect();
    logger.info('arrêt propre terminé (worker-cpu)');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, "erreur pendant l'arrêt (worker-cpu)");
    process.exit(1);
  }
}

process.on('SIGTERM', (signal) => void shutdown(signal));
process.on('SIGINT', (signal) => void shutdown(signal));

main().catch((err) => {
  logger.error({ err }, 'démarrage du worker CPU impossible');
  process.exit(1);
});
