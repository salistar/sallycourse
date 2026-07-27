// Révision automatique d'un cours (2026-07-26) — demande produit : « une
// feature qui fait un review du cours et corrige tout les erreurs et images
// mal générées ».
//
// Le processor DIAGNOSTIQUE puis ENFILE les réparations via les mécanismes
// existants (aucune nouvelle logique de réparation — on orchestre) :
//   - leçon en échec                → job 'regenerate-lesson' (contenu + média) ;
//   - image de slide absente/vide   → job slide-image (régénération, même clé) ;
//   - audio des leçons vidéo        → job audio-repair 'resynth' (diagnostic
//     silences + intelligibilité Whisper, resynthèse ciblée UNIQUEMENT des
//     slides défectueuses — une leçon saine ressort intacte) ;
//   - captures TP dégradées         → job screenshot-capture (recapture).
// Un rapport est persisté sur Course.reviewReport (Mixed additif) pour l'UI.
import type { Job } from 'bullmq';
import {
  Course,
  Lesson,
  QUEUES,
  Section,
  defaultJobOptions,
  makeJobId,
  notify,
  objectSize,
  slideScriptSchema,
  storageKeys,
} from '../shared.js';
import { createQueue, logger } from '../queues/index.js';
import { AUDIO_REPAIR_QUEUE, AUDIO_REPAIR_JOB, type AudioRepairJobData } from './audio-repair.js';
import { SLIDE_IMAGE_QUEUE, type SlideImageJobData } from './slide-image.js';
import { Queue } from 'bullmq';
import { getRedisConnection } from '../queues/connection.js';

export const COURSE_REVIEW_QUEUE = 'course-review';
export const COURSE_REVIEW_JOB = 'course-review-run';

export interface CourseReviewJobData {
  courseId: string;
}

/** Une action de réparation décidée par la révision. */
export interface ReviewAction {
  lessonId: string;
  lessonTitle: string;
  type: 'regenerate-lesson' | 'regenerate-image' | 'repair-audio' | 'recapture-tp';
  reason: string;
  /** Index de slide (actions image uniquement). */
  slideIndex?: number;
}

/** Rapport persisté sur Course.reviewReport. */
export interface CourseReviewReport {
  startedAt: string;
  finishedAt: string;
  lessonsScanned: number;
  actions: ReviewAction[];
}

/**
 * Une image de slide « générée » sous ce seuil est considérée RATÉE (PNG 896²
 * quasi vide / uni : les générations saines mesurées font 200 Ko - 1,5 Mo,
 * un raté type « image noire » sort sous ~10 Ko).
 */
export const MIN_HEALTHY_IMAGE_BYTES = 10_000;

function auxQueue<T>(name: string): Queue<T> {
  return new Queue<T>(name, { connection: getRedisConnection() as never });
}

export async function processCourseReview(job: Job<CourseReviewJobData>): Promise<CourseReviewReport> {
  const { courseId } = job.data;
  const startedAt = new Date().toISOString();

  const course = await Course.findById(courseId);
  if (!course) throw new Error(`cours introuvable : ${courseId}`);
  const lessons = await Lesson.find({ courseId }).sort({ order: 1 });
  const sections = await Section.find({ courseId }).select('order').lean();
  const sectionOrderById = new Map(sections.map((s) => [String(s._id), s.order]));

  const actions: ReviewAction[] = [];
  const contentQueue = createQueue(QUEUES.content);
  const screenshotQueue = createQueue(QUEUES.screenshot);
  const audioRepairQueue = auxQueue<AudioRepairJobData>(AUDIO_REPAIR_QUEUE);
  const slideImageQueue = auxQueue<SlideImageJobData>(SLIDE_IMAGE_QUEUE);

  try {
    for (const lesson of lessons) {
      const lessonId = String(lesson._id);

      // 1) Leçon en échec → régénération complète (contenu + média), unitaire.
      if (lesson.status === 'failed') {
        const jobId = makeJobId(courseId, QUEUES.content, lessonId);
        await contentQueue.remove(jobId).catch(() => undefined);
        await contentQueue.add('regenerate-lesson', { courseId, lessonId }, { ...defaultJobOptions, jobId });
        actions.push({ lessonId, lessonTitle: lesson.title, type: 'regenerate-lesson', reason: 'statut en échec' });
        continue; // la régénération refera images/audio — inutile d'empiler
      }
      if (lesson.status !== 'ready') continue; // pending/generating : ne pas interférer

      // 2) Leçons vidéo : images de slides ratées + audit audio complet.
      if (lesson.type === 'video') {
        const parsed = slideScriptSchema.safeParse(lesson.script);
        if (parsed.success) {
          const sectionOrder = sectionOrderById.get(String(lesson.sectionId)) ?? 0;
          const keys = storageKeys.course(courseId).lesson(sectionOrder, lesson.order);
          for (let i = 0; i < parsed.data.slides.length; i += 1) {
            const slide = parsed.data.slides[i]!;
            // Les images uploadées MANUELLEMENT par l'auteur ne sont jamais
            // « réparées » (c'est son choix éditorial).
            if (slide.imageSource === 'uploaded') continue;
            // Seuls les gabarits à slot d'illustration ont une image générée.
            if (slide.template !== 'content' && slide.template !== 'recap') continue;
            const size = await objectSize(keys.slideIllustration(i)).catch(() => null);
            if (size !== null && size < MIN_HEALTHY_IMAGE_BYTES) {
              const jobId = `slide-image-regenerate_${lessonId}_${i}`;
              await slideImageQueue.remove(jobId).catch(() => undefined);
              await slideImageQueue.add(
                'slide-image-regenerate',
                { courseId, lessonId, index: i },
                { ...defaultJobOptions, jobId },
              );
              actions.push({
                lessonId,
                lessonTitle: lesson.title,
                type: 'regenerate-image',
                reason: `image de slide ${i + 1} quasi vide (${size} octets)`,
                slideIndex: i,
              });
            }
          }
        }

        // Audit audio complet de la leçon (silences + intelligibilité Whisper) :
        // le processor audio-repair ne resynthétise QUE les slides défectueuses
        // et ré-assemble — une leçon saine ressort inchangée.
        const repairJobId = `${AUDIO_REPAIR_JOB}_${lessonId}`;
        await audioRepairQueue.remove(repairJobId).catch(() => undefined);
        await audioRepairQueue.add(
          AUDIO_REPAIR_JOB,
          { courseId, lessonId, mode: 'resynth' },
          { ...defaultJobOptions, jobId: repairJobId },
        );
        actions.push({ lessonId, lessonTitle: lesson.title, type: 'repair-audio', reason: 'audit audio complet (diagnostic + réparation ciblée)' });
      }

      // 3) TP : captures dégradées (cartons de repli, pas de vraies captures,
      // cf. lib/qa.ts checkTpScreenshots) → recapture complète du TP.
      if (lesson.type === 'tp') {
        const degraded = lesson.assets?.screenshotsDegraded?.length ?? 0;
        if (degraded > 0) {
          const jobId = makeJobId(courseId, QUEUES.screenshot, lessonId);
          await screenshotQueue.remove(jobId).catch(() => undefined);
          await screenshotQueue.add(QUEUES.screenshot, { courseId, lessonId }, { ...defaultJobOptions, jobId });
          actions.push({
            lessonId,
            lessonTitle: lesson.title,
            type: 'recapture-tp',
            reason: `${degraded} capture(s) dégradée(s)`,
          });
        }
      }
    }
  } finally {
    await Promise.all([
      audioRepairQueue.close().catch(() => undefined),
      slideImageQueue.close().catch(() => undefined),
    ]);
  }

  const report: CourseReviewReport = {
    startedAt,
    finishedAt: new Date().toISOString(),
    lessonsScanned: lessons.length,
    actions,
  };
  course.set('reviewReport', report);
  course.markModified('reviewReport');
  await course.save();

  await notify(String(course.userId), {
    type: 'course_review_done',
    title: 'Révision du cours terminée',
    body:
      actions.length === 0
        ? `« ${course.title} » : aucun défaut détecté.`
        : `« ${course.title} » : ${actions.length} réparation(s) lancée(s) (images, audio, TP).`,
    link: `/dashboard/courses/${courseId}`,
    email: false,
  }).catch(() => undefined);

  logger.info({ courseId, actions: actions.length }, 'révision de cours terminée');
  return report;
}
