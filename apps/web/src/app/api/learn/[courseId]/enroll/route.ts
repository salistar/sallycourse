import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import { getConfig } from '@sallycourse/shared';
import { connectDb, Enrollment, LmsListing } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { cmiCheckoutStub } from '@/lib/lms';
import { redeemCoupon } from '@/lib/coupons';

/**
 * POST /api/learn/[courseId]/enroll — inscription d'un apprenant à un cours
 * publié du LMS interne. Idempotent : ré-inscription = renvoie l'enrollment
 * existant. Paiement CMI STUBBÉ (Phase 4) : gratuit ou mock → accès immédiat.
 * Corps optionnel { couponCode? } (P139) : remise appliquée AVANT le stub de
 * checkout — décrémentation atomique du coupon, jamais rejouée si déjà inscrit.
 */

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { courseId } = await params;
  if (!isValidObjectId(courseId)) {
    return apiError('courseNotFound');
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

  // Le cours doit être publié sur le LMS interne pour être ouvert à l'inscription.
  const listing = await LmsListing.findOne({ courseId, published: true })
    .select('title priceCents userId')
    .lean();
  if (!listing) {
    return NextResponse.json({ error: 'Cours non disponible sur le LMS.', code: 'courseNotAvailableOnLms' }, { status: 404 });
  }

  // Déjà inscrit ? On renvoie l'existant (idempotence — le coupon n'est pas rejoué).
  const existing = await Enrollment.findOne({ studentId: user.id, courseId }).lean();
  if (existing) {
    return NextResponse.json({ id: String(existing._id), alreadyEnrolled: true }, { status: 200 });
  }

  let priceCents = listing.priceCents ?? 0;
  if (couponCode) {
    const redemption = await redeemCoupon({
      code: couponCode,
      priceCents,
      courseId,
      ownerId: String(listing.userId),
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
