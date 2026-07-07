import { isValidObjectId } from 'mongoose';
import { connectDb, Course, Enrollment } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { renderCertificateHtml } from '@/lib/lms';

/**
 * GET /api/learn/[courseId]/certificate — certificat de complétion (gabarit
 * PDF D10) rendu en HTML imprimable (« imprimer → PDF » côté navigateur).
 * Réservé à l'apprenant AYANT terminé le cours (completedAt renseigné).
 */

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { courseId } = await params;
  if (!isValidObjectId(courseId)) {
    return Response.json({ error: 'Cours introuvable.' }, { status: 404 });
  }

  await connectDb();

  const enrollment = await Enrollment.findOne({ studentId: user.id, courseId }).lean();
  if (!enrollment) {
    return Response.json({ error: 'Inscription requise.' }, { status: 403 });
  }
  if (!enrollment.completedAt) {
    return Response.json(
      { error: 'Terminez toutes les leçons pour obtenir votre certificat.' },
      { status: 409 },
    );
  }

  const course = await Course.findById(courseId).select('title locale').lean();
  if (!course) {
    return Response.json({ error: 'Cours introuvable.' }, { status: 404 });
  }

  const html = renderCertificateHtml({
    recipientName: user.name ?? user.email ?? 'Apprenant',
    courseTitle: course.title,
    certificateId: String(enrollment._id),
    completedAt: new Date(enrollment.completedAt),
    locale: course.locale,
  });

  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
