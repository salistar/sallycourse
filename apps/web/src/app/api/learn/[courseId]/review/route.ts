import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import {
  connectDb,
  CourseReview as CourseReviewModel,
  Enrollment as EnrollmentModel,
  LmsListing as LmsListingModel,
} from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { extractClientIp, rateLimit } from '@/lib/rate-limit';

/**
 * POST /api/learn/[courseId]/review — avis RÉEL d'un apprenant sur un cours du
 * LMS interne (Prompt 205). Seul un étudiant INSCRIT peut noter, une seule fois
 * par cours (upsert : un nouvel envoi remplace le précédent). C'est la seule
 * source d'avis affichée sur la page instructeur publique.
 *
 * Rate-limité (contenu affiché publiquement → cible de spam), par utilisateur
 * et par IP.
 */

export const dynamic = 'force-dynamic';

const REVIEW_USER_LIMIT = { limit: 10, windowSec: 3600 };
const REVIEW_IP_LIMIT = { limit: 30, windowSec: 3600 };

const bodySchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(600).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { courseId } = await params;
  if (!isValidObjectId(courseId)) {
    return apiError('courseNotFound');
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Avis invalide : une note de 1 à 5, commentaire de 600 caractères maximum.', code: 'invalidReview' },
      { status: 400 },
    );
  }

  const ip = extractClientIp(request);
  const [userLimit, ipLimit] = await Promise.all([
    rateLimit(`course-review:user:${user.id}`, REVIEW_USER_LIMIT),
    rateLimit(`course-review:ip:${ip}`, REVIEW_IP_LIMIT),
  ]);
  const hit = !userLimit.allowed ? userLimit : !ipLimit.allowed ? ipLimit : null;
  if (hit) {
    return NextResponse.json(
      { error: 'Trop d’avis envoyés, réessayez plus tard.', code: 'rate_limited' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil((hit.resetAt.getTime() - Date.now()) / 1000)),
        },
      },
    );
  }

  await connectDb();

  // Le cours doit être publié sur le LMS (un avis public suppose un cours public).
  const listing = await LmsListingModel.findOne({ courseId, published: true })
    .select('_id')
    .lean();
  if (!listing) {
    return apiError('courseNotFound');
  }

  // Ownership pédagogique : seul un apprenant INSCRIT peut déposer un avis.
  const enrollment = await EnrollmentModel.findOne({ studentId: user.id, courseId })
    .select('_id')
    .lean();
  if (!enrollment) {
    return NextResponse.json(
      { error: 'Inscription requise pour laisser un avis.', code: 'enrollmentRequiredForReview' },
      { status: 403 },
    );
  }

  const comment = parsed.data.comment?.trim() ?? '';
  const review = await CourseReviewModel.findOneAndUpdate(
    { studentId: user.id, courseId },
    { $set: { rating: parsed.data.rating, comment } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();

  return NextResponse.json({
    id: String(review._id),
    rating: review.rating,
    comment: review.comment ?? '',
  });
}
