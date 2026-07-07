import { NextResponse } from 'next/server';
import { connectDb, Course as CourseModel, User as UserModel } from '@sallycourse/db';
import { requireApiKeyUser } from '@/lib/api-auth';
import { createCourseForUser } from '@/lib/create-course';
import { v1CreateCourseSchema } from '@/lib/v1-schemas';

/**
 * API publique v1 — /api/v1/courses. Authentifiée par clé API (Bearer ou
 * X-API-Key). POST crée un cours et lance sa génération (même logique que l'UI,
 * quotas inclus) ; GET liste les cours du porteur de la clé.
 */

export const dynamic = 'force-dynamic';

/** POST /api/v1/courses — { title, difficulty?, locale?, platforms? } → cours créé. */
export async function POST(request: Request) {
  const auth = await requireApiKeyUser(request);
  if (auth instanceof Response) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 });
  }

  const parsed = v1CreateCourseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Données invalides.', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectDb();
  const userDoc = await UserModel.findById(auth.userId).select('plan').lean();
  if (!userDoc) {
    return NextResponse.json({ error: 'Utilisateur introuvable.' }, { status: 401 });
  }

  const result = await createCourseForUser(auth.userId, userDoc.plan, {
    title: parsed.data.title,
    difficulty: parsed.data.difficulty,
    locale: parsed.data.locale,
    targetPlatforms: parsed.data.platforms,
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

/** GET /api/v1/courses — cours du porteur de la clé, du plus récent au plus ancien. */
export async function GET(request: Request) {
  const auth = await requireApiKeyUser(request);
  if (auth instanceof Response) return auth;

  await connectDb();
  const courses = await CourseModel.find({ userId: auth.userId })
    .select('title difficulty status locale targetPlatforms createdAt updatedAt')
    .sort({ createdAt: -1 })
    .lean();

  return NextResponse.json({
    courses: courses.map((course) => ({
      id: String(course._id),
      title: course.title,
      difficulty: course.difficulty,
      status: course.status,
      locale: course.locale,
      platforms: course.targetPlatforms,
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
    })),
  });
}
