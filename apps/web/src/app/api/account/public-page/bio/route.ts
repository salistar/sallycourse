import { NextResponse } from 'next/server';
import { connectDb, User as UserModel } from '@sallycourse/db';
import type { Locale } from '@sallycourse/shared';
import { requireApiUser } from '@/lib/session';
import { extractClientIp, rateLimit } from '@/lib/rate-limit';
import { generateInstructorBio } from '@/lib/instructor-bio';
import { loadInstructorCatalogue } from '@/lib/instructor-profile';

/**
 * POST /api/account/public-page/bio — (re)génère la bio de la page instructeur
 * publique (Prompt 205) et la persiste sur User. Appel LLM déclenché par
 * l'utilisateur → RATE-LIMITÉ par utilisateur ET par IP (même patron que
 * /api/lms/courses/[id]/ask). Le prompt ne reçoit QUE le catalogue publié.
 */

export const dynamic = 'force-dynamic';

const BIO_USER_LIMIT = { limit: 5, windowSec: 3600 };
const BIO_IP_LIMIT = { limit: 20, windowSec: 3600 };

export async function POST(request: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const ip = extractClientIp(request);
  const [userLimit, ipLimit] = await Promise.all([
    rateLimit(`instructor-bio:user:${user.id}`, BIO_USER_LIMIT),
    rateLimit(`instructor-bio:ip:${ip}`, BIO_IP_LIMIT),
  ]);
  const hit = !userLimit.allowed ? userLimit : !ipLimit.allowed ? ipLimit : null;
  if (hit) {
    return NextResponse.json(
      { error: 'Trop de générations, réessayez plus tard.', code: 'rate_limited' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil((hit.resetAt.getTime() - Date.now()) / 1000)),
        },
      },
    );
  }

  await connectDb();

  const account = await UserModel.findById(user.id).select('name locale').lean();
  if (!account) {
    return NextResponse.json({ error: 'Compte introuvable.', code: 'accountNotFound' }, { status: 404 });
  }

  const courses = await loadInstructorCatalogue(String(user.id));
  if (courses.length === 0) {
    return NextResponse.json(
      {
        error: 'Publiez au moins un cours sur le LMS avant de générer votre bio.',
        code: 'no_published_course',
      },
      { status: 400 },
    );
  }

  const platforms = [...new Set(courses.flatMap((course) => course.links.map((l) => l.platform)))].sort();

  let bio;
  try {
    bio = await generateInstructorBio({
      name: account.name,
      locale: (account.locale ?? 'fr') as Locale,
      courses: courses.map((course) => ({
        title: course.title,
        summary: course.summary,
        lessonCount: course.lessonCount,
        durationMin: course.durationMin,
      })),
      platforms,
      studentCount: courses.reduce((sum, course) => sum + course.studentCount, 0),
    });
  } catch {
    return NextResponse.json(
      { error: 'Génération de la bio indisponible pour le moment, réessayez plus tard.', code: 'bioGenerationUnavailable' },
      { status: 502 },
    );
  }

  const generatedAt = new Date();
  await UserModel.updateOne(
    { _id: user.id },
    { $set: { instructorBio: { ...bio, generatedAt } } },
  );

  return NextResponse.json({ ...bio, generatedAt: generatedAt.toISOString() });
}
