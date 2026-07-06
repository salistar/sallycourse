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
  getObjectStream,
  makeJobId,
  publishProgress,
  slideScriptSchema,
  storageKeys,
  uploadObject,
  type SlideScript,
  type TtsJobData,
} from '../shared.js';
import { getRedisConnection } from '../queues/connection.js';
import { createQueue, logger } from '../queues/index.js';
import { synthesizeSlide } from '../media/tts.js';

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
  const { courseId, lessonId } = job.data;

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
    const voice = course.ttsVoice;

    let totalSeconds = 0;
    for (const [index, slide] of script.slides.entries()) {
      const pct = 10 + Math.round((index / script.slides.length) * 80);
      await report(courseId, pct, `Synthèse vocale slide ${index + 1}/${script.slides.length}`);

      const { cacheKey, seconds, provider } = await synthesizeSlide({
        text: slide.narration,
        locale,
        voice,
      });

      const audioKey = lessonKeys.audio(index);
      await copyCacheToLessonAudio(cacheKey, audioKey);

      slide.audioKey = audioKey;
      slide.audioSeconds = seconds;
      totalSeconds += seconds;
      logger.info({ lessonId, index, provider, seconds }, 'audio de slide prêt');
    }

    // Persiste le script enrichi (audioKey/audioSeconds par slide) + la durée audio agrégée.
    lesson.script = script;
    lesson.durationMin = Math.max(1, Math.round((totalSeconds / 60) * 10) / 10);
    lesson.markModified('script');
    await lesson.save();

    await report(courseId, 95, `Audio complet (${script.slides.length} slides, ${Math.round(totalSeconds)} s) — passage au rendu vidéo`);

    // Enchaîne sur le rendu vidéo de la leçon (jobId déterministe = déduplication).
    await createQueue(QUEUES.videoRender).add(
      QUEUES.videoRender,
      { courseId, lessonId },
      { jobId: makeJobId(courseId, QUEUES.videoRender, lessonId) },
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
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ courseId, lessonId, err }, 'échec de la synthèse vocale');
    await report(courseId, 0, `Échec de la synthèse vocale : ${message}`, 'error').catch(() => undefined);
    throw err;
  }
}
