import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import { getConfig } from '@sallycourse/shared';
import { connectDb, Enrollment, LmsListing } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { cmiCheckoutStub } from '@/lib/lms';

/**
 * POST /api/learn/[courseId]/enroll — inscription d'un apprenant à un cours
 * publié du LMS interne. Idempotent : ré-inscription = renvoie l'enrollment
 * existant. Paiement CMI STUBBÉ (Phase 4) : gratuit ou mock → accès immédiat.
 */

export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { courseId } = await params;
  if (!isValidObjectId(courseId)) {
    return NextResponse.json({ error: 'Cours introuvable.' }, { status: 404 });
  }

  await connectDb();

  // Le cours doit être publié sur le LMS interne pour être ouvert à l'inscription.
  const listing = await LmsListing.findOne({ courseId, published: true })
    .select('title priceCents')
    .lean();
  if (!listing) {
    return NextResponse.json({ error: 'Cours non disponible sur le LMS.' }, { status: 404 });
  }

  // Déjà inscrit ? On renvoie l'existant (idempotence).
  const existing = await Enrollment.findOne({ studentId: user.id, courseId }).lean();
  if (existing) {
    return NextResponse.json({ id: String(existing._id), alreadyEnrolled: true }, { status: 200 });
  }

  // STUB paiement CMI : gratuit/mock → accès accordé ; sinon 402 documenté.
  const checkout = cmiCheckoutStub(listing.priceCents ?? 0, getConfig().MOCK_PROVIDERS);
  if (!checkout.granted) {
    return NextResponse.json(
      { error: checkout.reason, redirectUrl: checkout.redirectUrl },
      { status: 402 },
    );
  }

  const enrollment = await Enrollment.create({
    studentId: user.id,
    courseId,
    courseTitle: listing.title,
    completedLessons: [],
  });

  return NextResponse.json(
    { id: String(enrollment._id), alreadyEnrolled: false, message: checkout.reason },
    { status: 201 },
  );
}
