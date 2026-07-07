import {
  PLANS,
  QUEUES,
  defaultJobOptions,
  makeJobId,
  type CreateCourseInput,
  type PlanId,
} from '@sallycourse/shared';
import {
  connectDb,
  Course as CourseModel,
  GenerationJob as GenerationJobModel,
} from '@sallycourse/db';
import { getOutlineQueue } from './queues';
import { checkAndReserveCourseQuota, releaseQuota } from './quota';

/**
 * Logique métier partagée de création de cours (quota mensuel → Course →
 * GenerationJob → enqueue outline). Extraite de /api/courses pour être
 * réutilisée telle quelle par l'API publique v1 (Prompt 51), garantissant un
 * comportement identique (quotas, jobId déterministe) quel que soit le point
 * d'entrée. La logique de quota vit dans lib/quota.ts (helper central, P53).
 */

export type CreateCourseError =
  | { kind: 'quota'; limit: number; plan: string }
  | { kind: 'user_not_found' }
  | { kind: 'create_failed' }
  | { kind: 'enqueue_failed' };

export type CreateCourseResult =
  | { ok: true; id: string; title: string; status: string }
  | { ok: false; error: CreateCourseError };

/**
 * Crée un cours pour un utilisateur et enfile la génération. Applique le quota
 * du plan (réservation atomique) et rend le crédit en cas d'échec. Retourne un
 * résultat typé — le mapping vers un status HTTP est laissé à l'appelant.
 */
export async function createCourseForUser(
  userId: string,
  plan: PlanId,
  input: CreateCourseInput,
): Promise<CreateCourseResult> {
  await connectDb();

  // Réservation atomique du crédit mensuel via le helper central (P53).
  const reservation = await checkAndReserveCourseQuota(userId);
  if (!reservation.ok) {
    if (reservation.reason === 'user_not_found') {
      return { ok: false, error: { kind: 'user_not_found' } };
    }
    return {
      ok: false,
      error: { kind: 'quota', limit: reservation.limit, plan: reservation.plan },
    };
  }

  // Filigrane exigé selon le plan (free=true) — appliqué à la création (P53).
  const watermark = PLANS[plan].watermark;

  let course;
  try {
    course = await CourseModel.create({
      userId,
      title: input.title,
      difficulty: input.difficulty,
      locale: input.locale,
      ttsVoice: input.ttsVoice,
      targetPlatforms: input.targetPlatforms,
      watermark,
      status: 'generating',
    });
  } catch {
    // La création a échoué après réservation : on rend le crédit.
    await releaseQuota(userId);
    return { ok: false, error: { kind: 'create_failed' } };
  }

  const courseId = course._id.toString();

  try {
    await GenerationJobModel.create({
      courseId: course._id,
      step: QUEUES.outline,
      progress: 0,
    });
    await getOutlineQueue().add(
      'outline',
      { courseId },
      { ...defaultJobOptions, jobId: makeJobId(courseId, QUEUES.outline) },
    );
  } catch {
    await CourseModel.updateOne({ _id: course._id }, { $set: { status: 'failed' } }).catch(
      () => undefined,
    );
    return { ok: false, error: { kind: 'enqueue_failed' } };
  }

  return { ok: true, id: courseId, title: course.title, status: course.status };
}
