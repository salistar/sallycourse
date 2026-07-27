import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import { defaultJobOptions } from '@sallycourse/shared';
import { connectDb, Course as CourseModel } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { COURSE_REVIEW_JOB, courseReviewJobId, getCourseReviewQueue } from '@/lib/queues';

/**
 * POST /api/courses/[id]/review — lance la RÉVISION AUTOMATIQUE d'un cours
 * (2026-07-26) : le worker diagnostique tout le cours (leçons en échec,
 * images de slides mal générées, audio inintelligible, captures TP dégradées)
 * et enfile les réparations correspondantes. Rapport persisté sur
 * Course.reviewReport + notification à la fin. Réservé aux cours déjà
 * générés (ready/published). 404 volontaire pour l'ownership.
 *
 * GET — renvoie le dernier rapport de révision (pour le panneau UI).
 */

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return apiError('courseNotFound');
  }

  await connectDb();

  const course = await CourseModel.findOne({ _id: id, userId: user.id }).select('status').lean();
  if (!course) {
    return apiError('courseNotFound');
  }
  if (course.status !== 'ready' && course.status !== 'published') {
    return apiError('courseStillGenerating');
  }

  const jobId = courseReviewJobId(id);
  try {
    const queue = getCourseReviewQueue();
    await queue.remove(jobId).catch(() => undefined);
    await queue.add(COURSE_REVIEW_JOB, { courseId: id }, { ...defaultJobOptions, jobId });
  } catch {
    return NextResponse.json(
      { error: 'Impossible de lancer la révision, réessayez plus tard.', code: 'cannotStartReview' },
      { status: 503 },
    );
  }

  return NextResponse.json({ id, status: 'review-started' }, { status: 202 });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return apiError('courseNotFound');
  }

  await connectDb();
  const course = await CourseModel.findOne({ _id: id, userId: user.id }).select('reviewReport').lean();
  if (!course) {
    return apiError('courseNotFound');
  }
  return NextResponse.json({ report: course.reviewReport ?? null });
}
