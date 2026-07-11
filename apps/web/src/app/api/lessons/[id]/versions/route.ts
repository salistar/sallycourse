import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import { connectDb, Course as CourseModel, Lesson as LessonModel, LessonVersion } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';

/**
 * GET /api/lessons/[id]/versions — historique des versions de contenu
 * éditable de la leçon (P131), plus récent d'abord. Ownership via le cours
 * parent ; 404 (pas 403) hors ownership pour ne pas révéler l'existence de
 * la leçon.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: 'Leçon introuvable.' }, { status: 404 });
  }

  await connectDb();

  const lesson = await LessonModel.findById(id).select('courseId').lean();
  if (!lesson) {
    return NextResponse.json({ error: 'Leçon introuvable.' }, { status: 404 });
  }

  const course = await CourseModel.findOne({ _id: lesson.courseId, userId: user.id })
    .select('_id')
    .lean();
  if (!course) {
    return NextResponse.json({ error: 'Leçon introuvable.' }, { status: 404 });
  }

  const versions = await LessonVersion.find({ lessonId: id })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  return NextResponse.json({
    versions: versions.map((version) => ({
      id: version._id.toString(),
      createdAt: version.createdAt.toISOString(),
      label: version.label,
      snapshot: version.snapshot,
    })),
  });
}
