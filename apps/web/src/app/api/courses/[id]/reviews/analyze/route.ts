import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import { connectDb, Course as CourseModel } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { getFeedbackQueue, FEEDBACK_JOB } from '@/lib/queues';

/**
 * POST /api/courses/[id]/reviews/analyze — déclenche l'analyse des retours
 * étudiants d'un cours (P62). Vérifie l'ownership, enfile un job sur la queue
 * 'review-feedback' : le worker récupère les avis Udemy (mock), les analyse via
 * Claude et persiste Course.improvementSuggestions. Réservé aux cours publiés
 * (ce sont les seuls susceptibles d'avoir des avis). 404 volontaire (pas 403).
 */

/** Statuts pour lesquels des avis étudiants peuvent exister. */
const REVIEWABLE_STATUSES = new Set(['ready', 'published']);

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: 'Cours introuvable.' }, { status: 404 });
  }

  await connectDb();

  const course = await CourseModel.findOne({ _id: id, userId: user.id })
    .select('_id status')
    .lean();
  if (!course) {
    return NextResponse.json({ error: 'Cours introuvable.' }, { status: 404 });
  }

  if (!REVIEWABLE_STATUSES.has(course.status)) {
    return NextResponse.json(
      { error: `Aucun retour étudiant disponible (statut : ${course.status}).` },
      { status: 409 },
    );
  }

  const courseId = course._id.toString();

  try {
    const queue = getFeedbackQueue();
    // jobId stable : une analyse déjà en file n'est pas dupliquée. On purge une
    // exécution terminée pour autoriser un vrai re-run à la demande.
    const jobId = `feedback:${courseId}`;
    await queue.remove(jobId).catch(() => undefined);
    await queue.add(FEEDBACK_JOB, { courseId }, { jobId, removeOnComplete: true, removeOnFail: 20 });
  } catch {
    return NextResponse.json(
      { error: "Impossible de lancer l'analyse des retours, réessayez plus tard." },
      { status: 503 },
    );
  }

  return NextResponse.json({ id: courseId, status: 'analyzing' }, { status: 202 });
}
