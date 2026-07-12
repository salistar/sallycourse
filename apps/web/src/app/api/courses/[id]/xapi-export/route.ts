import { isValidObjectId } from 'mongoose';
import {
  connectDb,
  Course,
  Enrollment,
  Lesson,
  LessonProgress,
  User as UserModel,
} from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { generateXapiReport } from '@/lib/xapi-export';
import type { XapiLessonCompletion, XapiReport } from '@/lib/xapi-export';

/**
 * GET /api/courses/[id]/xapi-export — export xAPI basique pour clients
 * entreprise (Prompt 144). Réservé au PROPRIÉTAIRE du cours : génère un
 * rapport de complétion (statements JSON simplifiés) par apprenant inscrit,
 * téléchargeable (content-disposition attachment). Un rapport = un tableau de
 * sous-rapports xAPI, un par apprenant.
 */

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id: courseId } = await params;
  if (!isValidObjectId(courseId)) {
    return Response.json({ error: 'Cours introuvable.' }, { status: 404 });
  }

  await connectDb();

  const course = await Course.findOne({ _id: courseId, userId: user.id })
    .select('title')
    .lean();
  if (!course) {
    return Response.json({ error: 'Cours introuvable.' }, { status: 404 });
  }

  const [enrollments, lessons, progress] = await Promise.all([
    Enrollment.find({ courseId }).lean(),
    Lesson.find({ courseId }).select('_id title').lean(),
    LessonProgress.find({ courseId }).lean(),
  ]);

  const lessonTitleById = new Map(lessons.map((l) => [String(l._id), l.title]));
  const studentIds = enrollments.map((e) => String(e.studentId));
  const students = await UserModel.find({ _id: { $in: studentIds } })
    .select('name email')
    .lean();
  const studentById = new Map(students.map((s) => [String(s._id), s]));

  const progressByStudent = new Map<string, typeof progress>();
  for (const p of progress) {
    const key = String(p.studentId);
    const list = progressByStudent.get(key) ?? [];
    list.push(p);
    progressByStudent.set(key, list);
  }

  const reports: XapiReport[] = enrollments.map((enr) => {
    const studentId = String(enr.studentId);
    const student = studentById.get(studentId);
    const rows = progressByStudent.get(studentId) ?? [];
    const completions: XapiLessonCompletion[] = rows
      .filter((r) => r.completedAt)
      .map((r) => ({
        lessonId: String(r.lessonId),
        lessonTitle: lessonTitleById.get(String(r.lessonId)) ?? 'Leçon',
        completedAt: r.completedAt as Date,
        score: r.quizScore,
        timeSpentSeconds: r.timeSpentSeconds,
      }));

    return generateXapiReport({
      actor: {
        studentId,
        name: student?.name ?? 'Apprenant',
        email: student?.email ?? `${studentId}@sallycourse.local`,
      },
      courseId,
      courseTitle: course.title,
      lessons: completions,
      courseCompletedAt: enr.completedAt ?? null,
    });
  });

  const payload = {
    format: 'xapi-statements-simplified',
    version: '1.0.3',
    exportedAt: new Date().toISOString(),
    courseId,
    courseTitle: course.title,
    reports,
  };

  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="xapi-export-${courseId}.json"`,
    },
  });
}
