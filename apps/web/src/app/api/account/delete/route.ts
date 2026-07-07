import { z } from 'zod';
import { deleteCoursePrefix } from '@sallycourse/shared';
import {
  ApiKey,
  Course as CourseModel,
  CourseAnalytics,
  Deployment,
  Enrollment,
  GenerationJob,
  Lesson,
  LmsListing,
  Notification,
  PlatformCredential,
  Quiz,
  Section,
  Subscription,
  User as UserModel,
  Webhook,
  connectDb,
} from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';

// Données personnelles : jamais de cache, runtime Node (accès Mongo + S3).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/account/delete — suppression RGPD (droit à l'effacement) du
 * compte connecté (P66). Confirmation forte exigée dans le corps (retape
 * l'email exact) pour éviter toute suppression accidentelle. Purge TOUTES
 * les collections référençant l'utilisateur ou ses cours, puis les médias
 * S3/MinIO de chaque cours, puis le compte lui-même.
 */

const bodySchema = z.object({
  /** Confirmation forte : l'utilisateur retape son adresse email exacte. */
  confirmEmail: z.string().trim().toLowerCase(),
});

export async function POST(request: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Corps JSON invalide.' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'Données invalides.', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectDb();

  const userId = user.id;
  const dbUser = await UserModel.findById(userId).select('email').lean();
  if (!dbUser) {
    return Response.json({ error: 'Utilisateur introuvable.' }, { status: 404 });
  }

  if (parsed.data.confirmEmail !== dbUser.email.toLowerCase()) {
    return Response.json(
      { error: 'La confirmation ne correspond pas à votre adresse email.' },
      { status: 400 },
    );
  }

  const courses = await CourseModel.find({ userId }).select('_id').lean();
  const courseIds = courses.map((c) => c._id);

  // Purge du contenu dérivé des cours de l'utilisateur.
  await Promise.all([
    Section.deleteMany({ courseId: { $in: courseIds } }),
    Lesson.deleteMany({ courseId: { $in: courseIds } }),
    Quiz.deleteMany({ courseId: { $in: courseIds } }),
    GenerationJob.deleteMany({ courseId: { $in: courseIds } }),
    Deployment.deleteMany({ courseId: { $in: courseIds } }),
    LmsListing.deleteMany({ courseId: { $in: courseIds } }),
    CourseAnalytics.deleteMany({ courseId: { $in: courseIds } }),
  ]);

  // Purge des médias S3/MinIO de chaque cours — best-effort : une erreur de
  // stockage ne doit pas bloquer l'effacement des données personnelles.
  await Promise.all(
    courseIds.map((id) => deleteCoursePrefix(String(id)).catch(() => undefined)),
  );

  await CourseModel.deleteMany({ userId });

  // Purge des collections rattachées directement à l'utilisateur (hors cours).
  await Promise.all([
    PlatformCredential.deleteMany({ userId }),
    ApiKey.deleteMany({ userId }),
    Webhook.deleteMany({ userId }),
    Subscription.deleteMany({ userId }),
    Notification.deleteMany({ userId }),
    Enrollment.deleteMany({ studentId: userId }),
  ]);

  await UserModel.deleteOne({ _id: userId });

  return Response.json({ ok: true });
}
