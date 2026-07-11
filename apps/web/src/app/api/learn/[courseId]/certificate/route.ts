import { isValidObjectId } from 'mongoose';
import { connectDb, Course, Enrollment, SchoolBranding, User as UserModel } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { renderCertificateHtml, resolveCertificateBranding } from '@/lib/lms';

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

  const course = await Course.findById(courseId).select('title locale userId').lean();
  if (!course) {
    return Response.json({ error: 'Cours introuvable.' }, { status: 404 });
  }

  // Marque blanche (Prompt 88) : branding de l'AUTEUR du cours (l'école qui a
  // publié la formation), pas de l'apprenant qui obtient le certificat.
  const [author, branding] = await Promise.all([
    UserModel.findById(course.userId).select('plan').lean(),
    SchoolBranding.findOne({ userId: course.userId }).lean(),
  ]);
  const resolvedBranding = resolveCertificateBranding(
    author?.plan,
    branding
      ? {
          schoolName: branding.schoolName,
          logoUrl: branding.logoUrl,
          primaryColorHex: branding.primaryColorHex,
          accentColorHex: branding.accentColorHex,
        }
      : null,
  );

  const html = renderCertificateHtml({
    recipientName: user.name ?? user.email ?? 'Apprenant',
    courseTitle: course.title,
    certificateId: String(enrollment._id),
    completedAt: new Date(enrollment.completedAt),
    locale: course.locale,
    branding: resolvedBranding,
  });

  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
