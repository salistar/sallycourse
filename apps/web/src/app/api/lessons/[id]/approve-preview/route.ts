import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import { nextVideoQualityStatus } from '@sallycourse/shared';
import { connectDb, Course as CourseModel, Lesson as LessonModel } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';

/**
 * POST /api/lessons/[id]/approve-preview — validation d'un aperçu rapide
 * (Prompt 133) : bascule Lesson.videoQualityStatus 'draft-ready' → 'approved'
 * (nextVideoQualityStatus, transition pure). Une leçon pas encore en
 * 'draft-ready' (aperçu jamais lancé, ou déjà approuvée) renvoie 409 — l'appel
 * n'a d'effet que sur un brouillon fraîchement rendu, en attente de validation.
 * 404 volontaire (pas 403) pour ne pas révéler les leçons des autres utilisateurs.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return apiError('lessonNotFound');
  }

  await connectDb();

  const lesson = await LessonModel.findById(id);
  if (!lesson) {
    return apiError('lessonNotFound');
  }

  const course = await CourseModel.findOne({ _id: lesson.courseId, userId: user.id }).select('_id').lean();
  if (!course) {
    return apiError('lessonNotFound');
  }

  const current = lesson.videoQualityStatus ?? 'none';
  const next = nextVideoQualityStatus(current, 'approved');
  if (next === current) {
    return NextResponse.json(
      { error: "Cette leçon n'a pas d'aperçu en attente de validation.", code: 'lessonHasNoPendingPreview' },
      { status: 409 },
    );
  }

  lesson.videoQualityStatus = next;
  await lesson.save();

  return NextResponse.json({ id: String(lesson._id), videoQualityStatus: next }, { status: 200 });
}
