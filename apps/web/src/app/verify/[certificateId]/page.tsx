import type { Metadata } from 'next';
import { isValidObjectId } from 'mongoose';
import { BadgeCheck, CalendarDays, GraduationCap, ShieldAlert, ShieldCheck } from 'lucide-react';
import { connectDb, Course, Enrollment, SchoolBranding, User as UserModel } from '@sallycourse/db';
import { resolveCertificateBranding } from '@/lib/lms';

/**
 * Page PUBLIQUE de vérification d'un certificat (Prompt 88) : le QR imprimé
 * sur le certificat PDF pointe vers /verify/{certificateId} (certificateId =
 * id de l'Enrollment). Aucune authentification requise — affiche le cours,
 * l'étudiant, la date de complétion et l'école (marque blanche si configurée,
 * sinon SALISTAR) quand le certificat est valide ; un état « non vérifié »
 * sinon (aucune fuite d'information sur l'existence d'autres ids).
 */

export const dynamic = 'force-dynamic';

interface VerifyPageProps {
  params: Promise<{ certificateId: string }>;
}

export async function generateMetadata({ params }: VerifyPageProps): Promise<Metadata> {
  const { certificateId } = await params;
  return {
    title: `Vérification de certificat — ${certificateId.slice(0, 8)}… — SallyCourse`,
    description: 'Vérifiez l’authenticité d’un certificat de complétion SallyCourse.',
  };
}

interface VerifiedCertificate {
  studentName: string;
  courseTitle: string;
  completionDate: string;
  schoolName: string;
  logoUrl: string | null;
}

/** Charge et vérifie un certificat — retourne null si introuvable/non complété. */
async function loadCertificate(certificateId: string): Promise<VerifiedCertificate | null> {
  if (!isValidObjectId(certificateId)) return null;

  await connectDb();
  const enrollment = await Enrollment.findById(certificateId)
    .select('studentId courseId courseTitle completedAt')
    .lean();
  if (!enrollment || !enrollment.completedAt) return null;

  const [student, course] = await Promise.all([
    UserModel.findById(enrollment.studentId).select('name email').lean(),
    Course.findById(enrollment.courseId).select('title userId').lean(),
  ]);
  if (!student || !course) return null;

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

  const completionDate = new Intl.DateTimeFormat('fr-FR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(enrollment.completedAt));

  return {
    studentName: student.name || student.email || 'Apprenant',
    courseTitle: course.title || enrollment.courseTitle,
    completionDate,
    schoolName: resolvedBranding?.schoolName ?? 'Salistar',
    // Le logo école n'est PAS présigné ici (page publique, pas de session) —
    // affichage texte uniquement ; le logo réel figure sur le PDF téléchargé
    // par l'étudiant depuis son espace authentifié.
    logoUrl: null,
  };
}

export default async function VerifyCertificatePage({ params }: VerifyPageProps) {
  const { certificateId } = await params;
  const certificate = await loadCertificate(certificateId);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-16">
      <div className="w-full max-w-lg">
        {certificate ? (
          <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
            <div className="flex items-center gap-3 border-b border-border bg-success/10 px-6 py-4">
              <ShieldCheck className="size-6 shrink-0 text-success" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-success">Certificat authentique</p>
                <p className="text-xs text-muted">Vérifié auprès de SallyCourse</p>
              </div>
            </div>

            <div className="flex flex-col gap-5 px-6 py-6">
              <div className="flex items-start gap-3">
                <GraduationCap className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Étudiant</p>
                  <p className="text-lg font-semibold text-foreground">{certificate.studentName}</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <BadgeCheck className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Cours suivi</p>
                  <p className="text-base font-medium text-foreground">{certificate.courseTitle}</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <CalendarDays className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Date de complétion</p>
                  <p className="text-base font-medium text-foreground">{certificate.completionDate}</p>
                </div>
              </div>

              <div className="mt-2 border-t border-border pt-4">
                <p className="text-xs text-muted">
                  Délivré par <span className="font-semibold text-foreground">{certificate.schoolName}</span> via
                  la plateforme SallyCourse.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
            <div className="flex items-center gap-3 border-b border-border bg-danger/10 px-6 py-4">
              <ShieldAlert className="size-6 shrink-0 text-danger" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-danger">Certificat non vérifié</p>
                <p className="text-xs text-muted">Identifiant introuvable ou cours non terminé</p>
              </div>
            </div>
            <div className="px-6 py-6">
              <p className="text-sm text-muted">
                Aucun certificat valide ne correspond à cet identifiant. Vérifiez le lien ou le QR code
                figurant sur le document, ou contactez l’émetteur du certificat.
              </p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
