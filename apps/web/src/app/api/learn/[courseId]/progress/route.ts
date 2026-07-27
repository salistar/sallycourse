import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { connectDb, Enrollment, Lesson } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { isCourseCompleted, mergeCompletedLesson } from '@/lib/lms';

/**
 * POST /api/learn/[courseId]/progress — marque une leçon terminée pour
 * l'apprenant inscrit. Recalcule l'état de complétion : quand toutes les
 * leçons du cours sont validées, pose `completedAt` (déclenche l'accès au
 * certificat). Requiert une inscription préalable.
 */

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  lessonId: z.string().min(1),
  /** false pour dé-cocher une leçon (retirer de la progression). */
  completed: z.boolean().default(true),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { courseId } = await params;
  if (!isValidObjectId(courseId)) {
    return apiError('courseNotFound');
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError('invalidRequest');
  }

  await connectDb();

  const enrollment = await Enrollment.findOne({ studentId: user.id, courseId });
  if (!enrollment) {
    return apiError('enrollmentRequired');
  }

  // Ids de leçons valides du cours (bornage anti-injection + total pour la complétion).
  const lessons = await Lesson.find({ courseId }).select('_id').lean();
  const validIds = lessons.map((l) => String(l._id));
  const total = validIds.length;

  const current = enrollment.completedLessons.map((id) => String(id));
  let next: string[];
  if (parsed.data.completed) {
    next = mergeCompletedLesson(current, parsed.data.lessonId, validIds);
  } else {
    next = current.filter((id) => id !== parsed.data.lessonId);
  }

  enrollment.set(
    'completedLessons',
    next.filter((id) => isValidObjectId(id)),
  );

  const done = isCourseCompleted(next.length, total);
  if (done && !enrollment.completedAt) {
    enrollment.completedAt = new Date();
  } else if (!done && enrollment.completedAt) {
    // Dé-complétion : on retire la date (le certificat n'est plus disponible).
    enrollment.completedAt = undefined;
  }
  await enrollment.save();

  return NextResponse.json({
    completedLessons: next,
    completedCount: next.length,
    total,
    completed: done,
    completedAt: enrollment.completedAt ?? null,
  });
}
