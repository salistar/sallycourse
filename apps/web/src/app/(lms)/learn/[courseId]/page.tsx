import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isValidObjectId } from 'mongoose';
import {
  connectDb,
  Coupon as CouponModel,
  Course as CourseModel,
  CourseReview as CourseReviewModel,
  Enrollment as EnrollmentModel,
  Lesson as LessonModel,
  LmsListing as LmsListingModel,
  Quiz as QuizModel,
  Section as SectionModel,
} from '@sallycourse/db';
import { applyDiscount, checkCouponValidity, getObjectStream, presignedGetUrl } from '@sallycourse/shared';
import { auth } from '@/lib/auth';
import { getTranslations } from 'next-intl/server';
import { CourseReviewForm, LearnCourseExperience } from '@/components/learn';
import type { LearnCourseView, LearnLessonView } from '@/components/learn';

/**
 * /learn/[courseId] — page cours du LMS interne. Server Component : vérifie que
 * le cours est publié, charge sections/leçons/quiz triés, présigne les URLs
 * vidéo et lit les articles Markdown depuis le stockage, puis délègue au client
 * <LearnCourseExperience /> (player, articles, quiz, progression, certificat).
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ courseId: string }>;
}): Promise<Metadata> {
  const { courseId } = await params;
  const t = await getTranslations('learn.course');
  if (!isValidObjectId(courseId)) return { title: t('metaTitleFallback') };
  await connectDb();
  const listing = await LmsListingModel.findOne({ courseId, published: true })
    .select('title summary')
    .lean();
  return {
    title: listing ? t('metaTitle', { title: listing.title }) : t('metaTitleFallback'),
    description: listing?.summary ?? undefined,
  };
}

/** Présigne une clé S3 vidéo/asset (1 h) ; http(s) conservé ; échec → undefined. */
async function safePresign(key: string | undefined): Promise<string | undefined> {
  if (!key) return undefined;
  if (/^https?:\/\//i.test(key)) return key;
  try {
    return await presignedGetUrl(key);
  } catch {
    return undefined;
  }
}

/** Télécharge le Markdown d'un article depuis sa clé S3 ; échec → undefined. */
async function safeReadMarkdown(key: string | undefined): Promise<string | undefined> {
  if (!key) return undefined;
  try {
    const stream = await getObjectStream(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf-8');
  } catch {
    return undefined;
  }
}

export default async function LearnCoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ promo?: string }>;
}) {
  const { courseId } = await params;
  const { promo } = await searchParams;
  if (!isValidObjectId(courseId)) notFound();

  await connectDb();

  const listing = await LmsListingModel.findOne({ courseId, published: true }).lean();
  if (!listing) notFound();

  const course = await CourseModel.findById(courseId).select('title locale').lean();
  if (!course) notFound();

  const [sections, lessons] = await Promise.all([
    SectionModel.find({ courseId }).sort({ order: 1 }).lean(),
    LessonModel.find({ courseId }).sort({ order: 1 }).lean(),
  ]);

  // Quiz indexés par leçon (une leçon 'quiz' porte ses questions).
  const quizzes = await QuizModel.find({ courseId }).lean();
  const quizByLesson = new Map(quizzes.map((q) => [String(q.lessonId), q.questions]));
  const sectionOrderById = new Map(sections.map((s) => [String(s._id), s.order]));

  // Progression apprenant (si connecté ET inscrit). Calculé AVANT les vues de
  // leçons : le contenu payant (article, réponses de quiz, transcription, liens
  // sandbox) ne doit être sérialisé QUE pour un apprenant inscrit.
  const session = await auth();
  const studentId = session?.user?.id;
  let enrolled = false;
  let completedLessons: string[] = [];
  let completedAt: string | null = null;
  // Avis déjà déposé par CET apprenant (P205) — pré-remplit le formulaire d'avis.
  let existingReview: { rating: number; comment: string } | null = null;
  if (studentId) {
    const enrollment = await EnrollmentModel.findOne({ studentId, courseId })
      .select('completedLessons completedAt')
      .lean();
    if (enrollment) {
      enrolled = true;
      completedLessons = enrollment.completedLessons.map((id) => String(id));
      completedAt = enrollment.completedAt ? new Date(enrollment.completedAt).toISOString() : null;

      const review = await CourseReviewModel.findOne({ studentId, courseId })
        .select('rating comment')
        .lean();
      if (review) {
        existingReview = { rating: review.rating, comment: review.comment ?? '' };
      }
    }
  }

  // Construit les vues de leçons. Anti-piratage : la vidéo n'est JAMAIS exposée
  // ici (lecture via POST …/watch filigrané). Le contenu textuel payant (article,
  // réponses+explications de quiz, transcription/sous-titres, liens sandbox TP)
  // n'est sérialisé que si `enrolled` — sinon un non-inscrit recevrait, dans le
  // HTML de la page, le cours complet et les corrigés de quiz gratuitement.
  const lessonViews: LearnLessonView[] = await Promise.all(
    lessons.map(async (l) => {
      const questions = quizByLesson.get(String(l._id)) ?? [];
      return {
        id: String(l._id),
        sectionId: String(l.sectionId),
        title: l.title,
        type: l.type,
        durationMin: l.durationMin ?? 0,
        videoUrl: undefined,
        captionsUrl: enrolled ? await safePresign(l.assets?.vttUrl) : undefined,
        transcriptUrl: enrolled ? await safePresign(l.assets?.txtUrl) : undefined,
        articleMd: enrolled && l.type === 'article' ? await safeReadMarkdown(l.assets?.articleMd) : undefined,
        quiz: enrolled
          ? questions.map((q) => ({
              question: q.question,
              choices: [...q.choices],
              correctIndex: q.correctIndex,
              explanation: q.explanation ?? '',
            }))
          : [],
        sandboxLinks:
          enrolled && l.assets?.sandboxLinks
            ? {
                language: l.assets.sandboxLinks.language,
                starter: { ...l.assets.sandboxLinks.starter },
                solution: { ...l.assets.sandboxLinks.solution },
              }
            : undefined,
      };
    }),
  );

  // Prix réduit affiché si un code promo valide accompagne l'URL (?promo=CODE,
  // posé par /promo/[code]) — affichage seul : le décrément atomique réel a
  // lieu au moment de l'inscription (voir /api/learn/[courseId]/enroll).
  const priceCents = listing.priceCents ?? 0;
  let promoPriceCents: number | undefined;
  let promoCode: string | undefined;
  if (promo) {
    const coupon = await CouponModel.findOne({ code: promo.trim().toUpperCase() }).lean();
    if (coupon && (!coupon.courseId || String(coupon.courseId) === courseId)) {
      const validity = checkCouponValidity(coupon, new Date());
      if (validity.valid) {
        promoCode = coupon.code;
        promoPriceCents = applyDiscount(priceCents, coupon);
      }
    }
  }

  const view: LearnCourseView = {
    id: courseId,
    title: course.title,
    summary: listing.summary,
    sections: sections
      .sort((a, b) => a.order - b.order)
      .map((s) => ({ id: String(s._id), title: s.title, order: s.order })),
    lessons: lessonViews.sort((a, b) => {
      const sa = sectionOrderById.get(a.sectionId) ?? 0;
      const sb = sectionOrderById.get(b.sectionId) ?? 0;
      return sa - sb;
    }),
    priceCents,
    currency: listing.currency ?? 'MAD',
  };

  return (
    <>
      <LearnCourseExperience
        course={view}
        isAuthenticated={Boolean(studentId)}
        enrolled={enrolled}
        completedLessons={completedLessons}
        completedAt={completedAt}
        promoCode={promoCode}
        promoPriceCents={promoPriceCents}
      />
      {/* Avis : réservé aux apprenants INSCRITS (P205) — alimente les avis
          publics agrégés sur la page instructeur (/@handle). */}
      {enrolled && (
        <section className="mx-auto w-full max-w-6xl px-6 pb-16">
          <CourseReviewForm courseId={courseId} existing={existingReview} />
        </section>
      )}
    </>
  );
}
