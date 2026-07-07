import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import { connectDb, Course as CourseModel, GenerationJob as GenerationJobModel } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';

/**
 * GET /api/courses/batch/status?ids=a,b,c — suivi groupé (P63).
 * Renvoie le statut + la progression courante des cours d'un lot, filtrés par
 * appartenance à l'utilisateur. Utilisé en polling par la page /dashboard/batch
 * (alternative simple et robuste au SSE pour N cours suivis en parallèle).
 */

/** Nombre max d'ids interrogés en un appel (borne le coût de la requête). */
const MAX_IDS = 200;

export async function GET(request: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const url = new URL(request.url);
  const idsParam = url.searchParams.get('ids') ?? '';
  const ids = idsParam
    .split(',')
    .map((s) => s.trim())
    .filter((s) => isValidObjectId(s))
    .slice(0, MAX_IDS);

  if (ids.length === 0) {
    return NextResponse.json({ courses: [] });
  }

  await connectDb();

  // Ownership : on ne renvoie que les cours appartenant à l'utilisateur.
  const courses = await CourseModel.find({ _id: { $in: ids }, userId: user.id })
    .select('_id title status')
    .lean();

  // Dernière progression connue par cours (job le plus récent).
  const jobs = await GenerationJobModel.find({ courseId: { $in: courses.map((c) => c._id) } })
    .select('courseId step progress updatedAt')
    .sort({ updatedAt: -1 })
    .lean();

  const latestByCourse = new Map<string, { step?: string; progress?: number }>();
  for (const job of jobs) {
    const key = String(job.courseId);
    if (!latestByCourse.has(key)) {
      latestByCourse.set(key, { step: job.step, progress: job.progress });
    }
  }

  return NextResponse.json({
    courses: courses.map((c) => {
      const latest = latestByCourse.get(String(c._id));
      return {
        id: String(c._id),
        title: c.title,
        status: c.status,
        step: latest?.step ?? null,
        progress: latest?.progress ?? 0,
      };
    }),
  });
}
