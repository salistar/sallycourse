import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { Types, isValidObjectId } from 'mongoose';
import { getConfig } from '@sallycourse/shared/config';
import { connectDb, Enrollment, LearningPath, LmsListing, PathEnrollment } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { cmiCheckoutStub } from '@/lib/lms';
import { redeemCoupon } from '@/lib/coupons';
import { orderedPathCourses } from '@/lib/learning-paths';

/**
 * POST /api/paths/[id]/enroll — inscription à un parcours publié (Prompt 199).
 *
 * Le prix bundle passe par le MÊME chemin d'encaissement que les cours :
 * redeemCoupon (P139) puis cmiCheckoutStub — donc prix > 0 hors mock ⇒ 402
 * documenté, exactement comme /api/learn/[courseId]/enroll.
 *
 * S'inscrire crée UN PathEnrollment + UN Enrollment par cours, en upsert :
 * une inscription (et sa progression) déjà existante n'est JAMAIS écrasée.
 * Idempotent : ré-inscription = pas de nouveau paiement, pas de coupon rejoué ;
 * les Enrollment manquants (cours ajouté au parcours après coup) sont
 * simplement complétés — le bundle a déjà été payé.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return apiError('pathNotFound');
  }

  // Corps optionnel — un couponCode absent ou un JSON vide ne bloque rien.
  let couponCode: string | undefined;
  try {
    const body = (await request.json()) as { couponCode?: unknown };
    if (typeof body?.couponCode === 'string' && body.couponCode.trim()) {
      couponCode = body.couponCode.trim();
    }
  } catch {
    /* corps absent/vide : inscription sans coupon */
  }

  await connectDb();

  const path = await LearningPath.findOne({ _id: id, published: true })
    .select('courses priceCents userId')
    .lean();
  if (!path) {
    return NextResponse.json({ error: 'Parcours non disponible.', code: 'pathUnavailable' }, { status: 404 });
  }

  const courses = orderedPathCourses(path);
  if (courses.length === 0) {
    return NextResponse.json({ error: 'Parcours non disponible.', code: 'pathUnavailable' }, { status: 404 });
  }

  // Titres figés à l'inscription (repris du catalogue LMS, comme pour un cours).
  const listings = await LmsListing.find({
    courseId: { $in: courses.map((course) => course.courseId) },
    published: true,
  })
    .select('courseId title')
    .lean();
  const titleByCourse = new Map(listings.map((listing) => [String(listing.courseId), listing.title]));

  // Déjà inscrit ? Aucun paiement ni coupon rejoué — on se contente de garantir
  // qu'un Enrollment existe pour chaque cours du parcours (upsert).
  const existing = await PathEnrollment.findOne({ studentId: user.id, pathId: id }).lean();
  if (existing) {
    await upsertCourseEnrollments(user.id, courses, titleByCourse);
    return NextResponse.json({ id: String(existing._id), alreadyEnrolled: true }, { status: 200 });
  }

  let priceCents = path.priceCents ?? 0;
  if (couponCode) {
    const redemption = await redeemCoupon({
      code: couponCode,
      priceCents,
      globalOnly: true,
      ownerId: String(path.userId),
    });
    if (!redemption.ok) {
      return NextResponse.json({ error: redemption.error }, { status: 400 });
    }
    priceCents = redemption.priceCents!;
  }

  // STUB paiement CMI : gratuit/mock → accès accordé ; sinon 402 documenté.
  const checkout = cmiCheckoutStub(priceCents, getConfig().MOCK_PROVIDERS);
  if (!checkout.granted) {
    return NextResponse.json(
      { error: checkout.reason, redirectUrl: checkout.redirectUrl },
      { status: 402 },
    );
  }

  await upsertCourseEnrollments(user.id, courses, titleByCourse);

  // Course concurrente possible sur le même parcours : l'index unique
  // (studentId, pathId) tranche — on relit alors l'inscription gagnante.
  try {
    const enrollment = await PathEnrollment.create({ studentId: user.id, pathId: id });
    return NextResponse.json(
      { id: String(enrollment._id), alreadyEnrolled: false, message: checkout.reason },
      { status: 201 },
    );
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    const winner = await PathEnrollment.findOne({ studentId: user.id, pathId: id }).lean();
    return NextResponse.json({ id: String(winner?._id), alreadyEnrolled: true }, { status: 200 });
  }
}

/**
 * Crée l'Enrollment manquant de chaque cours du parcours. `$setOnInsert` :
 * une inscription existante (et sa progression) est laissée INTACTE.
 */
async function upsertCourseEnrollments(
  studentId: string,
  courses: readonly { courseId: string }[],
  titleByCourse: ReadonlyMap<string, string>,
): Promise<void> {
  const student = new Types.ObjectId(studentId);

  await Enrollment.bulkWrite(
    courses.map((course) => {
      const courseId = new Types.ObjectId(course.courseId);
      return {
        updateOne: {
          filter: { studentId: student, courseId },
          update: {
            $setOnInsert: {
              studentId: student,
              courseId,
              courseTitle: titleByCourse.get(course.courseId) ?? '',
              completedLessons: [],
            },
          },
          upsert: true,
        },
      };
    }),
  );
}
