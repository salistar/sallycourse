// Point d'entrée du worker BullMQ — branche l'infrastructure de queues.
// Les processors métier (outline, contenu, TTS, …) seront enregistrés ici
// via registerWorker(QUEUES.xxx, processor) au fil des prompts suivants.
import mongoose from 'mongoose';
import { connectDb, getConfig, QUEUES, QUEUE_NAMES } from './shared.js';
import { closeAll, createQueue, logger, registerWorker, startHeartbeat } from './queues/index.js';
import { processOutlineGeneration } from './processors/outline-generation.js';
import { processContentGeneration } from './processors/content-generation.js';
import { processTtsGeneration } from './processors/tts-generation.js';
import { processSubtitleGeneration } from './processors/subtitle-generation.js';
import { processScreenshotCapture } from './processors/screenshot-capture.js';
import { processVideoRender } from './processors/video-render.js';
import { processPackaging } from './processors/packaging.js';
import { processDeployment } from './processors/deployment.js';
// Import à effet de bord : enregistre les adapters de déploiement dans le registre.
import './deploy/adapters/udemy.js';
import './deploy/adapters/podia.js';
import './deploy/adapters/gumroad.js';
import './deploy/adapters/skillshare.js';
import './deploy/adapters/lms.js';
import './deploy/adapters/youtube.js';
import './deploy/adapters/moodle.js';
import './deploy/adapters/teachable.js';
import './deploy/adapters/thinkific.js';
import { closeSlideBrowser } from './media/slide-renderer.js';
import { killTpContainersOlderThan } from './media/tp-environments.js';
import { startReviewScheduler, stopReviewScheduler } from './deploy/review-poll.js';

/** Reaper des conteneurs TP orphelins (P22) : au démarrage puis toutes les 15 min. */
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
  logger.info({ env: config.NODE_ENV }, 'worker SallyCourse : Mongo connecté');

  // Instancie les queues du pipeline (registre chaud, connexion Redis partagée).
  for (const name of QUEUE_NAMES) createQueue(name);
  logger.info({ queues: QUEUE_NAMES }, 'queues initialisées');

  // Processors métier (les étapes suivantes ajouteront les leurs ici).
  registerWorker(QUEUES.outline, processOutlineGeneration, { concurrency: 2 });
  registerWorker(QUEUES.content, processContentGeneration, { concurrency: 3 });
  registerWorker(QUEUES.tts, processTtsGeneration, { concurrency: 2 });
  registerWorker(QUEUES.subtitle, processSubtitleGeneration, { concurrency: 1 });
  registerWorker(QUEUES.screenshot, processScreenshotCapture, { concurrency: 1 });
  // Rendu vidéo FFmpeg : concurrency 1 (tâche CPU, un seul montage à la fois).
  registerWorker(QUEUES.videoRender, processVideoRender, { concurrency: 1 });
  // Packaging export ZIP : concurrency 1 (archive streamée + rendu PDF).
  registerWorker(QUEUES.packaging, processPackaging, { concurrency: 1 });
  // Déploiement plateformes (Udemy/YouTube) : concurrency 2.
  registerWorker(QUEUES.deployment, processDeployment, { concurrency: 2 });

  startHeartbeat();
  startTpReaper();

  // Cron review & alerting (P47) : poll quotidien du statut de revue des
  // déploiements, notification utilisateur, plan de correction en cas de rejet.
  await startReviewScheduler();
}

let shuttingDown = false;

/** Arrêt propre : workers → queues → Redis → Mongo, puis exit. */
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'arrêt du worker demandé');
  try {
    stopTpReaper();
    await stopReviewScheduler();
    await closeAll();
    await closeSlideBrowser();
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
