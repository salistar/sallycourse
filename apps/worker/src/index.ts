// Point d'entrée du worker BullMQ — branche l'infrastructure de queues.
// Les processors métier (outline, contenu, TTS, …) seront enregistrés ici
// via registerWorker(QUEUES.xxx, processor) au fil des prompts suivants.
import mongoose from 'mongoose';
import { connectDb, ensureBucket, getConfig } from './shared.js';
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
import { startStreakReminderScheduler, stopStreakReminderScheduler } from './lib/streak-reminder.js';
import { startBlogScheduler, stopBlogScheduler } from './lib/blog.js';
import { startDeployScheduleScheduler, stopDeployScheduleScheduler } from './lib/deploy-schedule.js';
import { startWatermarkWorker, stopWatermarkWorker } from './media/watermark-worker.js';
import { startVoiceIntakeWorker, stopVoiceIntakeWorker } from './voice/voice-intake-worker.js';
import { startScreencastRenderWorker, stopScreencastRenderWorker } from './voice/screencast-render-worker.js';
import { startAudioRepairWorker, stopAudioRepairWorker } from './voice/audio-repair-worker.js';
import { startSlideImageWorker, stopSlideImageWorker } from './media/slide-image-worker.js';
import { startManualAudioIntakeWorker, stopManualAudioIntakeWorker } from './voice/manual-audio-intake-worker.js';
import { startCourseReviewWorker, stopCourseReviewWorker } from './media/course-review-worker.js';

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

  // Bucket S3/MinIO créé s'il n'existe pas (constaté en réel le 2026-07-25 :
  // après une réinitialisation du disque Docker, `ensureBucket` existait dans
  // packages/shared mais n'était appelé NULLE PART — chaque upload échouait en
  // « The specified bucket does not exist » jusqu'à création manuelle).
  // Idempotent (BucketAlreadyOwnedByYou ignoré) et sans effet en mock.
  if (!config.MOCK_PROVIDERS) {
    await ensureBucket();
    logger.info('bucket de stockage vérifié/créé');
  }

  // Instancie + enregistre toutes les queues (comportement historique : tout
  // dans un seul process). P71 : chaque groupe peut aussi tourner isolément
  // via les entrypoints dédiés (src/entrypoints/worker-{cpu,api,browser}.ts).
  const apiQueues = registerApiQueues();
  const cpuQueues = registerCpuQueues();
  const browserQueues = registerBrowserQueues();
  logger.info({ queues: [...apiQueues, ...cpuQueues, ...browserQueues] }, 'queues initialisées');

  // Analyse des retours étudiants (P62) : queue dédiée hors registre typé.
  startFeedbackWorker();

  // Filigrane paresseux du LMS (P206) : queue dédiée hors registre typé,
  // consomme les jobs enfilés à la 1re lecture d'un étudiant (rendu + cache S3).
  startWatermarkWorker();

  // Dictée vocale de création de cours (P210) : queue dédiée hors registre typé,
  // consomme les jobs enfilés par POST /api/voice/dictation (Whisper + LLM).
  startVoiceIntakeWorker();

  // Rendu de capture d'écran uploadée (Feature B) : queue dédiée hors registre
  // typé, consomme les jobs enfilés par POST …/lessons/[lessonId]/screencast
  // (narration TTS + incrustation des légendes via ffmpeg).
  startScreencastRenderWorker();

  // Réparation audio d'une leçon vidéo déjà générée (Lot 2, plan 2026-07-20) :
  // queue dédiée hors registre typé, consomme les jobs enfilés par
  // POST …/lessons/[lessonId]/audio-repair (débruitage ou resynthèse ciblée).
  startAudioRepairWorker();

  // Régénération d'image de slide à la demande (Lot 3, plan 2026-07-20) :
  // queue dédiée hors registre typé, consomme les jobs enfilés par
  // POST …/lessons/[lessonId]/slides/[index]/image (appel Modal SDXL).
  startSlideImageWorker();

  // Intégration audio manuelle par slide (Lot 4, plan 2026-07-20) : queue
  // dédiée hors registre typé, consomme les jobs enfilés par
  // POST …/lessons/[lessonId]/slides/[index]/audio (normalisation loudnorm).
  startManualAudioIntakeWorker();

  // Révision automatique d'un cours (2026-07-26) : diagnostic complet (images
  // ratées, audio, TP dégradés, leçons en échec) + réparations enfilées via
  // les mécanismes existants. Jobs enfilés par POST /api/courses/[id]/review.
  startCourseReviewWorker();

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

  // Cron rappel de série (P200) : passage quotidien (18 h UTC) sur les profils
  // de gamification dont la série est en danger (actif hier, pas aujourd'hui) →
  // notification in-app + Web Push. Aucun email.
  await startStreakReminderScheduler();

  // Blog SEO (P204) : passage horaire qui publie les articles arrivés à
  // échéance, et traitement des jobs de (re)génération enfilés à la publication
  // d'un cours (adapter LMS) ou par le tableau de bord.
  await startBlogScheduler();

  // Déploiements programmés « drip » (P181) : passage horaire qui, pour chaque
  // plan actif dû, publie le lot suivant par plateforme (clips TikTok/Instagram
  // ou enfilage du déploiement de cours), et publie les ShortClip programmés dus.
  await startDeployScheduleScheduler();
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
    await stopStreakReminderScheduler();
    await stopBlogScheduler();
    await stopDeployScheduleScheduler();
    await stopWatermarkWorker();
    await stopVoiceIntakeWorker();
    await stopScreencastRenderWorker();
    await stopAudioRepairWorker();
    await stopSlideImageWorker();
    await stopManualAudioIntakeWorker();
    await stopCourseReviewWorker();
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
