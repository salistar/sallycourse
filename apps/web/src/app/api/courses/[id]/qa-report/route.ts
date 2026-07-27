import { isValidObjectId } from 'mongoose';
import { apiError } from '@/lib/api-error';
import { connectDb, Course } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';

// Données personnelles : jamais de cache, runtime Node (accès Mongo).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/courses/[id]/qa-report — rapport de contrôle qualité (Prompt 26).
 * Vérifie l'authentification + l'ownership, puis renvoie Course.qaReport
 * (null si le contrôle n'a pas encore tourné).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return apiError('courseNotFound');
  }

  await connectDb();

  // Ownership : 404 pour ne pas révéler les cours des autres utilisateurs.
  const course = await Course.findOne({ _id: id, userId: user.id })
    .select('qaReport status')
    .lean();
  if (!course) {
    return apiError('courseNotFound');
  }

  return Response.json({
    status: course.status,
    qaReport: course.qaReport ?? null,
  });
}
