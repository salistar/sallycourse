import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { isValidObjectId } from 'mongoose';
import { BadgeCheck, CalendarDays, GraduationCap, ShieldAlert, ShieldCheck } from 'lucide-react';
import {
  connectDb,
  Course,
  Enrollment,
  LearningPath,
  PathEnrollment,
  SchoolBranding,
  User as UserModel,
} from '@sallycourse/db';
import { resolveCertificateBranding } from '@/lib/lms';

/**
 * Page PUBLIQUE de vérification d'un certificat (Prompt 88) : le QR imprimé
 * sur le certificat PDF pointe vers /verify/{certificateId} (certificateId =
 * id de l'Enrollment). Aucune authentification requise — affiche le cours,
 * l'étudiant, la date de complétion et l'école (marque blanche si configurée,
 * sinon SALISTAR) quand le certificat est valide ; un état « non vérifié »
 * sinon (aucune fuite d'information sur l'existence d'autres ids).
 *
 * P199 — MÊME URL publique pour un certificat de PARCOURS : si l'identifiant ne
 * correspond à aucun Enrollment, on retombe sur PathEnrollment (dont l'_id est
 * l'identifiant imprimé sur le certificat de parcours).
 */

export const dynamic = 'force-dynamic';

interface VerifyPageProps {
  params: Promise<{ certificateId: string }>;
}

export async function generateMetadata({ params }: VerifyPageProps): Promise<Metadata> {
  const { certificateId } = await params;
  const t = await getTranslations('certificate');
  return {
    title: t('metaTitle', { id: certificateId.slice(0, 8) }),
    description: t('metaDescription'),
  };
}

interface VerifiedCertificate {
  studentName: string;
  courseTitle: string;
  /** « Cours suivi » ou « Parcours suivi » (P199) — même page, deux natures. */
  subjectLabel: string;
  completionDate: string;
  schoolName: string;
  logoUrl: string | null;
}

/** Nom de l'école émettrice (marque blanche P88) ou « Salistar » par défaut. */
async function issuerName(authorId: unknown): Promise<string> {
  const [author, branding] = await Promise.all([
    UserModel.findById(authorId).select('plan').lean(),
    SchoolBranding.findOne({ userId: authorId }).lean(),
  ]);
  const resolved = resolveCertificateBranding(
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
  return resolved?.schoolName ?? 'Salistar';
}

/** Date de complétion formatée dans la langue de la page publique (fr). */
function formatCompletionDate(when: Date | string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(when));
}

/** Certificat de COURS — identifiant = _id d'un Enrollment (P43/P88). */
async function loadCourseCertificate(certificateId: string): Promise<VerifiedCertificate | null> {
  const enrollment = await Enrollment.findById(certificateId)
    .select('studentId courseId courseTitle completedAt')
    .lean();
  if (!enrollment || !enrollment.completedAt) return null;

  const [student, course] = await Promise.all([
    UserModel.findById(enrollment.studentId).select('name email').lean(),
    Course.findById(enrollment.courseId).select('title userId').lean(),
  ]);
  if (!student || !course) return null;

  return {
    studentName: student.name || student.email || '',
    courseTitle: course.title || enrollment.courseTitle,
    subjectLabel: 'courseSubject',
    completionDate: formatCompletionDate(enrollment.completedAt),
    schoolName: await issuerName(course.userId),
    // Le logo école n'est PAS présigné ici (page publique, pas de session) —
    // affichage texte uniquement ; le logo réel figure sur le PDF téléchargé
    // par l'étudiant depuis son espace authentifié.
    logoUrl: null,
  };
}

/** Certificat de PARCOURS — identifiant = _id d'un PathEnrollment (P199). */
async function loadPathCertificate(certificateId: string): Promise<VerifiedCertificate | null> {
  const enrollment = await PathEnrollment.findById(certificateId)
    .select('studentId pathId completedAt')
    .lean();
  if (!enrollment || !enrollment.completedAt) return null;

  const [student, path] = await Promise.all([
    UserModel.findById(enrollment.studentId).select('name email').lean(),
    LearningPath.findById(enrollment.pathId).select('title userId').lean(),
  ]);
  if (!student || !path) return null;

  return {
    studentName: student.name || student.email || '',
    courseTitle: path.title,
    subjectLabel: 'pathSubject',
    completionDate: formatCompletionDate(enrollment.completedAt),
    schoolName: await issuerName(path.userId),
    logoUrl: null,
  };
}

/**
 * Charge et vérifie un certificat — cours d'abord, parcours en repli (les deux
 * natures partagent la même URL publique). null si introuvable/non complété.
 */
async function loadCertificate(certificateId: string): Promise<VerifiedCertificate | null> {
  if (!isValidObjectId(certificateId)) return null;

  await connectDb();
  return (
    (await loadCourseCertificate(certificateId)) ?? (await loadPathCertificate(certificateId))
  );
}

export default async function VerifyCertificatePage({ params }: VerifyPageProps) {
  const { certificateId } = await params;
  const t = await getTranslations('certificate');
  const certificate = await loadCertificate(certificateId);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-16">
      <div className="w-full max-w-lg">
        {certificate ? (
          <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
            <div className="flex items-center gap-3 border-b border-border bg-success/10 px-6 py-4">
              <ShieldCheck className="size-6 shrink-0 text-success" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-success">{t('authentic')}</p>
                <p className="text-xs text-muted">{t('verifiedWith')}</p>
              </div>
            </div>

            <div className="flex flex-col gap-5 px-6 py-6">
              <div className="flex items-start gap-3">
                <GraduationCap className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t('student')}</p>
                  <p className="text-lg font-semibold text-foreground">{certificate.studentName || t('learnerFallback')}</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <BadgeCheck className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {t(certificate.subjectLabel)}
                  </p>
                  <p className="text-base font-medium text-foreground">{certificate.courseTitle}</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <CalendarDays className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t('completionDate')}</p>
                  <p className="text-base font-medium text-foreground">{certificate.completionDate}</p>
                </div>
              </div>

              <div className="mt-2 border-t border-border pt-4">
                <p className="text-xs text-muted">
                  {t.rich('issuedBy', {
                    name: certificate.schoolName,
                    b: (chunks) => <span className="font-semibold text-foreground">{chunks}</span>,
                  })}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
            <div className="flex items-center gap-3 border-b border-border bg-danger/10 px-6 py-4">
              <ShieldAlert className="size-6 shrink-0 text-danger" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-danger">{t('notVerified')}</p>
                <p className="text-xs text-muted">{t('notVerifiedHint')}</p>
              </div>
            </div>
            <div className="px-6 py-6">
              <p className="text-sm text-muted">{t('notVerifiedBody')}</p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
