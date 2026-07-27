import { isValidObjectId } from 'mongoose';
import { apiError } from '@/lib/api-error';
import {
  connectDb,
  Course as CourseModel,
  LearningPath,
  PathEnrollment,
  SchoolBranding,
  User as UserModel,
} from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { renderCertificateHtml, resolveCertificateBranding } from '@/lib/lms';
import { derivePathProgress, orderedPathCourses } from '@/lib/learning-paths';

/**
 * GET /api/paths/[id]/certificate — certificat de PARCOURS (Prompt 199), rendu
 * en HTML imprimable comme le certificat de cours. Aucun nouveau gabarit : le
 * gabarit `certificate` est réutilisé avec certLabel/descriptionLine.
 *
 * Exige que TOUS les cours du parcours soient complétés — la vérification est
 * dérivée des Enrollment existants, jamais d'un compteur dupliqué. La première
 * émission pose PathEnrollment.completedAt (dont l'_id sert d'identifiant de
 * vérification publique sur /verify/[certificateId]).
 */

export const dynamic = 'force-dynamic';

const CERT_LABEL_PATH = 'Certificat de parcours';
const CERT_DESCRIPTION_PATH = 'pour avoir suivi et validé l’intégralité du parcours';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return apiError('pathNotFound');
  }

  await connectDb();

  const path = await LearningPath.findById(id).select('title userId courses').lean();
  if (!path) {
    return apiError('pathNotFound');
  }

  const enrollment = await PathEnrollment.findOne({ studentId: user.id, pathId: id });
  if (!enrollment) {
    return apiError('enrollmentRequired');
  }

  const { progress } = await derivePathProgress(path, user.id);
  if (!progress.completed) {
    return Response.json(
      { error: 'Terminez tous les cours du parcours pour obtenir votre certificat.', code: 'completeAllPathCoursesForCertificate' },
      { status: 409 },
    );
  }

  // Première émission : on fige la date de complétion du parcours.
  if (!enrollment.completedAt) {
    enrollment.completedAt = new Date();
    await enrollment.save();
  }

  // Langue du certificat : celle du premier cours du parcours (défaut fr).
  const ordered = orderedPathCourses(path);
  const firstCourse = ordered[0]
    ? await CourseModel.findById(ordered[0].courseId).select('locale').lean()
    : null;

  // Marque blanche (P88) : branding de l'AUTEUR du parcours (l'école), pas de
  // l'apprenant — même règle que le certificat de cours.
  const [author, branding] = await Promise.all([
    UserModel.findById(path.userId).select('plan').lean(),
    SchoolBranding.findOne({ userId: path.userId }).lean(),
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
    courseTitle: path.title,
    certificateId: String(enrollment._id),
    completedAt: enrollment.completedAt,
    locale: firstCourse?.locale ?? 'fr',
    branding: resolvedBranding,
    certLabel: CERT_LABEL_PATH,
    descriptionLine: CERT_DESCRIPTION_PATH,
  });

  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
