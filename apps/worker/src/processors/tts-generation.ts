// Processor BullMQ « tts-generation » : pour chaque slide du script vidéo d'une
// leçon, synthétise la narration en mp3 normalisé (media/tts.ts), l'uploade sous
// storageKeys…audio(i), et enregistre audioKey + audioSeconds sur la slide. Puis
// enfile video-render pour la leçon. Publie la progression et gère le statut.
import type { Job } from 'bullmq';
import {
  Course,
  Lesson,
  QUEUES,
  Section,
  User,
  getObjectStream,
  makeJobId,
  notify,
  publishProgress,
  slideScriptSchema,
  storageKeys,
  ttsVoiceForMode,
  uploadObject,
  type SlideScript,
  type TtsJobData,
} from '../shared.js';
import { getRedisConnection } from '../queues/connection.js';
import { createQueue, logger } from '../queues/index.js';
import { priorityForPlan } from '../queues/priority.js';
import { planForCourse } from '../queues/plan-lookup.js';
import { synthesizeSlide } from '../media/tts.js';
import { recordTtsCost } from '../lib/cost.js';
import { mongoCheckpointStore, withCheckpoint } from '../lib/idempotency.js';
import { CourseCancelledError, checkCancelled } from '../lib/cancellation.js';

export interface TtsResult {
  courseId: string;
  lessonId: string;
  slides: number;
  totalSeconds: number;
}

/** Publie la progression du step tts-generation (best-effort). */
async function report(
  courseId: string,
  progress: number,
  message: string,
  level: 'info' | 'warn' | 'error' = 'info',
): Promise<void> {
  try {
    await publishProgress(getRedisConnection(), {
      courseId,
      step: QUEUES.tts,
      progress,
      message,
      level,
      ts: Date.now(),
    });
  } catch (err) {
    logger.warn({ courseId, err }, 'publication de progression impossible');
  }
}

/** Copie un objet du cache TTS vers la clé audio définitive de la slide. */
async function copyCacheToLessonAudio(cacheKey: string, audioKey: string): Promise<void> {
  if (cacheKey === audioKey) return;
  const stream = await getObjectStream(cacheKey);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  await uploadObject(audioKey, Buffer.concat(chunks), 'audio/mpeg');
}

/**
 * Synthétise la narration de toutes les slides d'une leçon vidéo, persiste les
 * clés/durées audio sur Lesson.script, puis enfile video-render. Jette en cas
 * d'échec (le worker BullMQ gère alors les retentatives + marquage GenerationJob).
 */
export async function processTtsGeneration(job: Job<TtsJobData>): Promise<TtsResult> {
  const { courseId, lessonId, mode } = job.data;

  try {
    await report(courseId, 5, 'Chargement de la leçon pour la synthèse vocale');
    const lesson = await Lesson.findById(lessonId);
    if (!lesson) throw new Error(`leçon introuvable : ${lessonId}`);
    if (lesson.type !== 'video') {
      throw new Error(`tts-generation : leçon ${lessonId} de type « ${lesson.type} » (attendu : video)`);
    }

    const parsed = slideScriptSchema.safeParse(lesson.script);
    if (!parsed.success) {
      throw new Error(`script vidéo absent ou invalide pour la leçon ${lessonId} — lancez d'abord la génération de contenu`);
    }
    const script: SlideScript = parsed.data;

    const course = await Course.findById(courseId);
    if (!course) throw new Error(`cours introuvable : ${courseId}`);
    const section = await Section.findById(lesson.sectionId);
    if (!section) throw new Error(`section introuvable pour la leçon ${lessonId}`);

    const lessonKeys = storageKeys.course(courseId).lesson(section.order, lesson.order);
    const locale = course.locale;
    // Aperçu rapide (P133) : voix standard par langue FORCÉE (jamais de voix
    // clonée) — la voix la plus rapide/économique à générer, adaptée à un
    // brouillon jetable. En mode 'final' (ou absent) : voix du cours inchangée.
    const voice = ttsVoiceForMode(mode ?? 'final', course.ttsVoice);
    // Vitesse de narration configurable (P137, accessibilité) — undefined → 1
    // (débit standard, comportement inchangé pour les cours existants).
    const narrationSpeed = course.narrationSpeed;
    // Plan du propriétaire (P153) : ElevenLabs est une option PREMIUM — le plan
    // réel est connu ici (via planForCourse), donc on l'indique explicitement
    // à synthesizeSlide pour activer la vérification (free → Piper/Kokoro only).
    const plan = await planForCourse(courseId);

    // Traçabilité voix clonée (P81) : si la voix utilisée est la voix clonée du
    // propriétaire du cours, on logue l'usage via une Notification interne
    // (watermark = log de conformité, pas de tatouage audio — voir voice-clone.ts).
    // Best-effort, une seule fois par leçon (pas par slide). Ignoré en mode
    // aperçu rapide : la voix clonée n'est jamais utilisée dans ce mode.
    if (voice) {
      const owner = await User.findById(course.userId).select('clonedVoiceId').lean();
      if (owner?.clonedVoiceId && owner.clonedVoiceId === voice) {
        await notify(String(course.userId), {
          type: 'voice_clone_used',
          title: 'Voix clonée utilisée',
          body: `Votre voix clonée a été utilisée pour générer l'audio de la leçon « ${lesson.title ?? lessonId} ».`,
          link: `/dashboard/courses/${courseId}`,
          email: false,
        }).catch((err) => logger.warn({ courseId, lessonId, err }, 'log traçabilité voix clonée échoué'));
      }
    }

    // Reprise granulaire (P69) : chaque slide synthétisée est checkpointée
    // (GenerationJob.checkpoint) AVANT de passer à la suivante. Si le worker
    // crashe au milieu de la boucle, la relance rejoue les slides déjà faites
    // depuis le checkpoint (aucun re-appel payant, aucun saut) et ne traite
    // réellement que les slides restantes.
    interface SlideAudioCheckpoint {
      audioKey: string;
      audioSeconds: number;
      provider: string;
    }

    const { results: slideResults } = await withCheckpoint<typeof script.slides[number], SlideAudioCheckpoint>({
      jobId: lessonId,
      steps: script.slides,
      store: mongoCheckpointStore(courseId, QUEUES.tts),
      runStep: async (slide, index) => {
        // Annulation (P73) : vérifiée AVANT chaque slide — une annulation en
        // cours de boucle arrête le traitement sans perdre les slides déjà faites
        // (checkpointées) ni bloquer sur un appel TTS inutile.
        await checkCancelled(courseId);
        const { cacheKey, seconds, provider } = await synthesizeSlide({
          text: slide.narration,
          locale,
          voice,
          speed: narrationSpeed,
          plan,
        });

        const audioKey = lessonKeys.audio(index);
        await copyCacheToLessonAudio(cacheKey, audioKey);

        // Coût TTS : facturé au caractère, uniquement pour une vraie synthèse
        // (un hit de cache a déjà été facturé lors de sa première production).
        if (provider !== 'cache') {
          await recordTtsCost(
            { courseId, userId: String(course.userId) },
            slide.narration.length,
            provider,
          ).catch(() => undefined);
        }

        logger.info({ lessonId, index, provider, seconds }, 'audio de slide prêt');
        return { audioKey, audioSeconds: seconds, provider };
      },
      onStep: async ({ index, total, result, resumed }) => {
        // Réapplique le résultat (rejoué ou frais) sur la slide en mémoire, et
        // persiste immédiatement le script partiel : une reprise ultérieure
        // (même sans checkpoint, ex. inspection manuelle) retrouve l'état réel.
        const target = script.slides[index];
        if (target) {
          target.audioKey = result.audioKey;
          target.audioSeconds = result.audioSeconds;
        }
        if (!resumed) {
          lesson.script = script;
          lesson.markModified('script');
          await lesson.save().catch(() => undefined);
        }
        const pct = 10 + Math.round(((index + 1) / total) * 80);
        await report(courseId, pct, `Synthèse vocale slide ${index + 1}/${total}${resumed ? ' (déjà faite — reprise)' : ''}`);
      },
    });

    const totalSeconds = slideResults.reduce((acc, r) => acc + r.audioSeconds, 0);

    // Persiste le script final (audioKey/audioSeconds par slide) + la durée audio agrégée.
    lesson.script = script;
    lesson.durationMin = Math.max(1, Math.round((totalSeconds / 60) * 10) / 10);
    lesson.markModified('script');
    await lesson.save();

    await report(courseId, 95, `Audio complet (${script.slides.length} slides, ${Math.round(totalSeconds)} s) — passage au rendu vidéo`);

    // Enchaîne sur le rendu vidéo de la leçon (jobId déterministe = déduplication).
    // Priorité (P73) selon le plan du propriétaire du cours (déjà résolu ci-dessus).
    const videoPriority = priorityForPlan(plan);
    await createQueue(QUEUES.videoRender).add(
      QUEUES.videoRender,
      { courseId, lessonId, ...(mode ? { mode } : {}) },
      { jobId: makeJobId(courseId, QUEUES.videoRender, lessonId), priority: videoPriority },
    );

    await report(courseId, 100, `Synthèse vocale terminée : ${script.slides.length} slides`);
    const result: TtsResult = {
      courseId,
      lessonId,
      slides: script.slides.length,
      totalSeconds: Math.round(totalSeconds * 100) / 100,
    };
    logger.info({ ...result }, 'tts-generation terminée, video-render enfilé');
    return result;
  } catch (err) {
    // Annulation utilisateur (P73) : arrêt propre, PAS de retry BullMQ (le job
    // ne se remet pas en file — le cours est déjà 'cancelled').
    if (err instanceof CourseCancelledError) {
      logger.info({ courseId, lessonId }, 'synthèse vocale interrompue (cours annulé)');
      await report(courseId, 0, 'Génération annulée par l\'utilisateur.', 'warn').catch(() => undefined);
      return { courseId, lessonId, slides: 0, totalSeconds: 0 };
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ courseId, lessonId, err }, 'échec de la synthèse vocale');
    await report(courseId, 0, `Échec de la synthèse vocale : ${message}`, 'error').catch(() => undefined);
    throw err;
  }
}
