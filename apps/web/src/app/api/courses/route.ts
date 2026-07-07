import { NextResponse } from 'next/server';
import { createCourseInputSchema } from '@sallycourse/shared';
import { connectDb, Course as CourseModel } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { createCourseForUser } from '@/lib/create-course';

/**
 * /api/courses — création (POST) et listing (GET) des cours de l'utilisateur.
 * La création délègue à createCourseForUser (quota mensuel → Course →
 * GenerationJob → enqueue outline), logique partagée avec l'API publique v1.
 */

export async function POST(request: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

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

  const result = await createCourseForUser(user.id!, user.plan ?? 'free', parsed.data);
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
