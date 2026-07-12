// Point d'entrée du worker BullMQ — branche l'infrastructure de queues.
// Les processors métier (outline, contenu, TTS, …) seront enregistrés ici
// via registerWorker(QUEUES.xxx, processor) au fil des prompts suivants.
import mongoose from 'mongoose';
import { connectDb, getConfig } from './shared.js';
import { closeAll, getRegisteredQueues, logger, startHeartbeat } from './queues/index.js';
import { startQueueBlockedScheduler, stopQueueBlockedScheduler, type BlockableQueueLike } from './lib/alerts.js';
import { registerApiQueues, registerCpuQueues, registerBrowserQueues } from './entrypoints/register-groups.js';
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
import './deploy/adapters/hotmart.js';
import './deploy/adapters/kajabi.js';
import './deploy/adapters/coursera-edx.js';
import './deploy/adapters/linkedin-learning.js';
import './deploy/adapters/systeme-io.js';
import './deploy/adapters/wordpress-learndash.js';
import './deploy/adapters/discord.js';
import './deploy/adapters/telegram.js';
import { closeSlideBrowser } from './media/slide-renderer.js';
import { killTpContainersOlderThan } from './media/tp-environments.js';
import { startReviewScheduler, stopReviewScheduler } from './deploy/review-poll.js';
import { startAnalyticsScheduler, stopAnalyticsScheduler } from './lib/analytics/refresh.js';
import { startAbTestingScheduler, stopAbTestingScheduler } from './deploy/ab-testing.js';
import { startFeedbackWorker, stopFeedbackWorker } from './deploy/feedback-loop.js';
import { startMetricsServer, stopMetricsServer } from './lib/metrics-server.js';
import { startRetentionScheduler, stopRetentionScheduler } from './lib/retention.js';
import { startCourseRefreshScheduler, stopCourseRefreshScheduler } from './lib/course-refresh.js';
import { startEmailSequenceScheduler, stopEmailSequenceScheduler } from './lib/email-sequence.js';
import { startAuditRetentionScheduler, stopAuditRetentionScheduler } from './lib/audit-retention.js';

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

  // Instancie + enregistre toutes les queues (comportement historique : tout
  // dans un seul process). P71 : chaque groupe peut aussi tourner isolément
  // via les entrypoints dédiés (src/entrypoints/worker-{cpu,api,browser}.ts).
  const apiQueues = registerApiQueues();
  const cpuQueues = registerCpuQueues();
  const browserQueues = registerBrowserQueues();
  logger.info({ queues: [...apiQueues, ...cpuQueues, ...browserQueues] }, 'queues initialisées');

  // Analyse des retours étudiants (P62) : queue dédiée hors registre typé.
  startFeedbackWorker();

  startHeartbeat();
  startTpReaper();

  // Serveur de métriques interne (P75) : GET /metrics, scrappé par uptime-kuma
  // ou tout autre superviseur (profil docker-compose MONITORING).
  startMetricsServer();

  // Scan anti-blocage des queues (P75) : alerte ops si le job en attente le
  // plus ancien dépasse le seuil (queue qui n'avance plus). Cast : l'API Queue
  // BullMQ est structurellement compatible (getJobs(['waiting','delayed'])
  // retourne des Job pourvus d'un id/timestamp), seul le typage générique gêne.
  startQueueBlockedScheduler(() => getRegisteredQueues() as unknown as readonly BlockableQueueLike[]);

  // Cron review & alerting (P47) : poll quotidien du statut de revue des
  // déploiements, notification utilisateur, plan de correction en cas de rejet.
  await startReviewScheduler();

  // Cron analytics (P61) : rafraîchissement périodique des métriques des cours
  // publiés (Udemy/YouTube), agrégé ensuite par le dashboard.
  await startAnalyticsScheduler();

  // Cron A/B testing des landing pages (P87) : rotation round-robin hebdomadaire
  // des variantes de titre (marketingSchema.titleIdeas) par cours/plateforme.
  await startAbTestingScheduler();

  // Cron archivage à froid (P79) : marque Course.archived=true après 90+
  // jours d'inactivité (exclusion des listings actifs, réactivable).
  await startRetentionScheduler();

  // Cron mise à jour des cours (P91) : détection trimestrielle de sujets
  // probablement obsolètes (raisonnement LLM, pas de recherche web réelle),
  // suggestions persistées + notification — jamais de régénération automatique.
  await startCourseRefreshScheduler();

  // Cron séquences email marketing (P140) : envoi horaire des étapes dues
  // (EmailSequenceEnrollment.nextSendAt <= now) via le service d'email existant.
  await startEmailSequenceScheduler();

  // Cron purge du journal d'audit (P149) : rétention 12 mois, purge quotidienne
  // des entrées AuditLog expirées (seul point qui supprime des entrées d'audit).
  await startAuditRetentionScheduler();
}

let shuttingDown = false;

/** Arrêt propre : workers → queues → Redis → Mongo, puis exit. */
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'arrêt du worker demandé');
  try {
    stopTpReaper();
    stopQueueBlockedScheduler();
    await stopReviewScheduler();
    await stopAnalyticsScheduler();
    await stopAbTestingScheduler();
    await stopRetentionScheduler();
    await stopCourseRefreshScheduler();
    await stopEmailSequenceScheduler();
    await stopAuditRetentionScheduler();
    await stopFeedbackWorker();
    await stopMetricsServer();
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
