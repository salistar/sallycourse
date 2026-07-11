import { NextResponse } from 'next/server';
import { createCourseInputSchema } from '@sallycourse/shared';
import { connectDb, Course as CourseModel } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { createCourseForUser } from '@/lib/create-course';
import { extractClientIp, rateLimit } from '@/lib/rate-limit';
import { moderateCourseTitle } from '@/lib/moderation';

/**
 * /api/courses — création (POST) et listing (GET) des cours de l'utilisateur.
 * La création délègue à createCourseForUser (quota mensuel → Course →
 * GenerationJob → enqueue outline), logique partagée avec l'API publique v1.
 * P70 : rate limiting (IP + utilisateur) et modération du titre avant génération.
 */

/** Limites POST /api/courses — au-delà, l'IP ou l'utilisateur patiente. */
const COURSE_CREATE_IP_LIMIT = { limit: 20, windowSec: 60 };
const COURSE_CREATE_USER_LIMIT = { limit: 10, windowSec: 60 };

export async function POST(request: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const ip = extractClientIp(request);
  const [ipLimit, userLimit] = await Promise.all([
    rateLimit(`courses:ip:${ip}`, COURSE_CREATE_IP_LIMIT),
    rateLimit(`courses:user:${user.id}`, COURSE_CREATE_USER_LIMIT),
  ]);
  const hit = !ipLimit.allowed ? ipLimit : !userLimit.allowed ? userLimit : null;
  if (hit) {
    return NextResponse.json(
      { error: 'Trop de créations de cours, réessayez plus tard.', code: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((hit.resetAt.getTime() - Date.now()) / 1000)) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 });
  }

  const parsed = createCourseInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Données invalides.', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  // Modération du titre AVANT réservation de quota / création (P70).
  const moderation = await moderateCourseTitle(parsed.data.title);
  if (!moderation.allowed) {
    return NextResponse.json(
      {
        error: moderation.reason ?? 'Ce titre de cours ne peut pas être généré.',
        code: 'content_blocked',
        category: moderation.category,
      },
      { status: 422 },
    );
  }

  // Import de contenu existant (P90) : quand le formulaire signale qu'un
  // upload de matériel source va suivre juste après (POST .../import-material),
  // on laisse un court délai avant le premier traitement du job outline pour
  // éviter la course entre l'enqueue et l'upload (best-effort, non bloquant :
  // un flag absent ou upload en retard dégrade simplement vers "sans contexte").
  const willImportMaterial = Boolean((body as { importsMaterial?: unknown })?.importsMaterial);

  const result = await createCourseForUser(user.id!, user.plan ?? 'free', parsed.data, {
    ...(willImportMaterial ? { enqueueDelayMs: 8000 } : {}),
  });
  if (!result.ok) {
    switch (result.error.kind) {
      case 'quota':
        return NextResponse.json(
          {
            error: `Quota mensuel atteint : ${result.error.limit} cours/mois sur le plan ${result.error.plan}.`,
            code: 'quota_exceeded',
          },
          { status: 402 },
        );
      case 'user_not_found':
        return NextResponse.json({ error: 'Utilisateur introuvable.' }, { status: 401 });
      case 'enqueue_failed':
        return NextResponse.json(
          { error: 'Impossible de démarrer la génération, réessayez plus tard.' },
          { status: 503 },
        );
      default:
        return NextResponse.json({ error: 'Erreur interne, réessayez plus tard.' }, { status: 500 });
    }
  }

  return NextResponse.json(
    { id: result.id, title: result.title, status: result.status },
    { status: 201 },
  );
}

/** GET /api/courses — cours de l'utilisateur, du plus récent au plus ancien. */
export async function GET() {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  await connectDb();

  const courses = await CourseModel.find({ userId: user.id })
    .sort({ createdAt: -1 })
    .lean();

  return NextResponse.json({
    courses: courses.map((course) => ({
      id: String(course._id),
      title: course.title,
      difficulty: course.difficulty,
      status: course.status,
      locale: course.locale,
      targetPlatforms: course.targetPlatforms,
      coverImageUrl: course.coverImageUrl ?? null,
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
    })),
  });
}
