import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import { connectDb, Course as CourseModel, LmsListing as LmsListingModel } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { extractClientIp, rateLimit } from '@/lib/rate-limit';
import { getBlogQueue, BLOG_GENERATE_JOB } from '@/lib/queues';

/**
 * POST /api/courses/[id]/blog — (re)génère le blog SEO d'un cours publié (P204).
 * Le blog est normalement produit AUTOMATIQUEMENT à la publication du cours
 * (adapter LMS) : cette route sert au bouton « Régénérer » du tableau de bord.
 * Ownership (404, jamais 403) + rate-limit : le job déclenche 1 + N appels LLM.
 */

export const dynamic = 'force-dynamic';

/** Régénération coûteuse (7 appels LLM) : quota volontairement serré. */
const BLOG_USER_LIMIT = { limit: 5, windowSec: 3600 };
const BLOG_IP_LIMIT = { limit: 20, windowSec: 3600 };

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return apiError('courseNotFound');
  }

  const ip = extractClientIp(_request);
  const [userLimit, ipLimit] = await Promise.all([
    rateLimit(`course-blog:user:${user.id}`, BLOG_USER_LIMIT),
    rateLimit(`course-blog:ip:${ip}`, BLOG_IP_LIMIT),
  ]);
  const hit = !userLimit.allowed ? userLimit : !ipLimit.allowed ? ipLimit : null;
  if (hit) {
    return NextResponse.json(
      { error: 'Trop de régénérations demandées, réessayez plus tard.', code: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((hit.resetAt.getTime() - Date.now()) / 1000)) } },
    );
  }

  await connectDb();

  // Ownership : 404 (et non 403) — convention du repo, ne révèle pas l'existence.
  const course = await CourseModel.findOne({ _id: id, userId: user.id }).select('_id').lean();
  if (!course) {
    return apiError('courseNotFound');
  }

  const courseId = course._id.toString();

  // Le blog fait la promotion de la page publique du cours : sans publication
  // sur le LMS, le CTA et le JSON-LD pointeraient dans le vide.
  const listing = await LmsListingModel.findOne({ courseId, published: true }).select('_id').lean();
  if (!listing) {
    return NextResponse.json(
      { error: 'Publiez le cours sur le LMS avant de générer son blog SEO.', code: 'publishToLmsBeforeSeoBlog' },
      { status: 409 },
    );
  }

  try {
    const queue = getBlogQueue();
    // jobId stable : une génération déjà en file n'est pas dupliquée ; on purge
    // une exécution terminée pour autoriser une vraie régénération à la demande.
    const jobId = `${BLOG_GENERATE_JOB}:${courseId}`;
    await queue.remove(jobId).catch(() => undefined);
    await queue.add(BLOG_GENERATE_JOB, { courseId, reason: 'manual' }, { jobId, removeOnComplete: 20, removeOnFail: 50 });
  } catch {
    return NextResponse.json(
      { error: 'Impossible de lancer la génération du blog, réessayez plus tard.', code: 'blogGenerationStartFailed' },
      { status: 503 },
    );
  }

  return NextResponse.json({ id: courseId, status: 'generating' }, { status: 202 });
}
