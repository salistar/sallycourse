import { NextResponse } from 'next/server';
import {
  PLANS,
  QUEUES,
  createCourseInputSchema,
  defaultJobOptions,
  makeJobId,
} from '@sallycourse/shared';
import {
  connectDb,
  Course as CourseModel,
  GenerationJob as GenerationJobModel,
  User as UserModel,
} from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { getOutlineQueue } from '@/lib/queues';

/**
 * /api/courses — création (POST) et listing (GET) des cours de l'utilisateur.
 * La création vérifie le quota mensuel du plan, crée le Course + le
 * GenerationJob initial puis enfile le job outline dans BullMQ.
 */

/** Vrai si les deux dates tombent dans le même mois calendaire (UTC). */
function isSameUtcMonth(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
}

const quotaResponse = (limit: number, plan: string) =>
  NextResponse.json(
    {
      error: `Quota mensuel atteint : ${limit} cours/mois sur le plan ${plan}.`,
      code: 'quota_exceeded',
    },
    { status: 402 },
  );

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

  await connectDb();

  // ── Quota mensuel du plan ─────────────────────────────────────
  const plan = user.plan ?? 'free';
  const limit = PLANS[plan].coursesPerMonth;
  const quotaEnforced = Number.isFinite(limit);

  if (quotaEnforced) {
    const now = new Date();
    const userDoc = await UserModel.findById(user.id).lean();
    if (!userDoc) {
      return NextResponse.json({ error: 'Utilisateur introuvable.' }, { status: 401 });
    }

    const periodStart = userDoc.quotaUsed?.periodStart
      ? new Date(userDoc.quotaUsed.periodStart)
      : new Date(0);
    const samePeriod = isSameUtcMonth(periodStart, now);
    const used = samePeriod ? (userDoc.quotaUsed?.coursesThisMonth ?? 0) : 0;

    if (used >= limit) return quotaResponse(limit, plan);

    // Réservation du crédit — conditionnelle pour rester correct en cas de
    // double soumission concurrente ; nouveau mois → remise à zéro du compteur.
    const reserved = samePeriod
      ? await UserModel.updateOne(
          { _id: user.id, 'quotaUsed.coursesThisMonth': { $lt: limit } },
          { $inc: { 'quotaUsed.coursesThisMonth': 1 } },
        )
      : await UserModel.updateOne(
          { _id: user.id },
          { $set: { quotaUsed: { coursesThisMonth: 1, periodStart: now } } },
        );

    if (reserved.modifiedCount === 0) return quotaResponse(limit, plan);
  }

  // ── Création du cours + job de génération ─────────────────────
  const input = parsed.data;
  let course;
  try {
    course = await CourseModel.create({
      userId: user.id,
      title: input.title,
      difficulty: input.difficulty,
      locale: input.locale,
      ttsVoice: input.ttsVoice,
      targetPlatforms: input.targetPlatforms,
      status: 'generating',
    });
  } catch {
    // Création échouée : on rend le crédit réservé.
    if (quotaEnforced) {
      await UserModel.updateOne(
        { _id: user.id, 'quotaUsed.coursesThisMonth': { $gt: 0 } },
        { $inc: { 'quotaUsed.coursesThisMonth': -1 } },
      );
    }
    return NextResponse.json({ error: 'Erreur interne, réessayez plus tard.' }, { status: 500 });
  }

  const courseId = course._id.toString();

  try {
    await GenerationJobModel.create({
      courseId: course._id,
      step: QUEUES.outline,
      progress: 0,
    });

    // jobId déterministe : re-poster le même step ne crée pas de doublon.
    await getOutlineQueue().add(
      'outline',
      { courseId },
      { ...defaultJobOptions, jobId: makeJobId(courseId, QUEUES.outline) },
    );
  } catch {
    // Redis/Mongo indisponible : le cours passe en échec, visible côté UI.
    await CourseModel.updateOne({ _id: course._id }, { $set: { status: 'failed' } }).catch(
      () => undefined,
    );
    return NextResponse.json(
      { error: 'Impossible de démarrer la génération, réessayez plus tard.' },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { id: courseId, title: course.title, status: course.status },
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
