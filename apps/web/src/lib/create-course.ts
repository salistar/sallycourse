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
  User as UserModel,
} from '@sallycourse/db';
import { getOutlineQueue } from './queues';

/**
 * Logique métier partagée de création de cours (quota mensuel → Course →
 * GenerationJob → enqueue outline). Extraite de /api/courses pour être
 * réutilisée telle quelle par l'API publique v1 (Prompt 51), garantissant un
 * comportement identique (quotas, jobId déterministe) quel que soit le point
 * d'entrée.
 */

/** Vrai si les deux dates tombent dans le même mois calendaire (UTC). */
function isSameUtcMonth(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
}

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

  const limit = PLANS[plan].coursesPerMonth;
  const quotaEnforced = Number.isFinite(limit);

  if (quotaEnforced) {
    const now = new Date();
    const userDoc = await UserModel.findById(userId).lean();
    if (!userDoc) return { ok: false, error: { kind: 'user_not_found' } };

    const periodStart = userDoc.quotaUsed?.periodStart
      ? new Date(userDoc.quotaUsed.periodStart)
      : new Date(0);
    const samePeriod = isSameUtcMonth(periodStart, now);
    const used = samePeriod ? (userDoc.quotaUsed?.coursesThisMonth ?? 0) : 0;

    if (used >= limit) return { ok: false, error: { kind: 'quota', limit, plan } };

    // Réservation atomique du crédit — correcte en cas de double soumission.
    const reserved = samePeriod
      ? await UserModel.updateOne(
          { _id: userId, 'quotaUsed.coursesThisMonth': { $lt: limit } },
          { $inc: { 'quotaUsed.coursesThisMonth': 1 } },
        )
      : await UserModel.updateOne(
          { _id: userId },
          { $set: { quotaUsed: { coursesThisMonth: 1, periodStart: now } } },
        );

    if (reserved.modifiedCount === 0) {
      return { ok: false, error: { kind: 'quota', limit, plan } };
    }
  }

  let course;
  try {
    course = await CourseModel.create({
      userId,
      title: input.title,
      difficulty: input.difficulty,
      locale: input.locale,
      ttsVoice: input.ttsVoice,
      targetPlatforms: input.targetPlatforms,
      status: 'generating',
    });
  } catch {
    if (quotaEnforced) {
      await UserModel.updateOne(
        { _id: userId, 'quotaUsed.coursesThisMonth': { $gt: 0 } },
        { $inc: { 'quotaUsed.coursesThisMonth': -1 } },
      );
    }
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
