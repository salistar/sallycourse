import { NextResponse } from 'next/server';
import { getConfig, isValidCouponCodeShape } from '@sallycourse/shared';
import { connectDb, Coupon, CouponClick, LmsListing } from '@sallycourse/db';
import { logger } from '@/lib/logger';

/**
 * GET /promo/[code] — page promo trackée (Prompt 139). Applique le coupon
 * (juste la RÉSOLUTION du prix affiché — le décrément atomique réel n'a lieu
 * qu'au moment du checkout, voir /api/learn/[courseId]/enroll) et redirige
 * vers la page du cours ciblé avec le prix réduit affiché (?promo=code).
 *
 * Best-effort : un code inconnu/malformé redirige quand même (jamais d'erreur
 * visible pour un visiteur qui clique un lien promo), vers le catalogue LMS.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await context.params;
  const appUrl = getConfig().APP_URL;
  const fallback = NextResponse.redirect(new URL('/learn', appUrl), { status: 302 });

  if (!isValidCouponCodeShape(rawCode)) return fallback;
  const code = rawCode.trim().toUpperCase();

  try {
    await connectDb();
    const coupon = await Coupon.findOne({ code }).lean();
    if (!coupon) return fallback;

    // Tracking du clic — best-effort, jamais bloquant pour la redirection.
    await CouponClick.create({
      couponId: coupon._id,
      code,
      userAgent: request.headers.get('user-agent')?.slice(0, 300),
    }).catch((err) => logger.warn({ err, code }, 'Promo : échec de l’enregistrement du clic'));

    // Cours ciblé par le coupon (s'il en a un) ; sinon catalogue général.
    if (!coupon.courseId) {
      return NextResponse.redirect(new URL(`/learn?promo=${code}`, appUrl), { status: 302 });
    }

    const listing = await LmsListing.findOne({ courseId: coupon.courseId, published: true })
      .select('courseId')
      .lean();
    if (!listing) return fallback;

    return NextResponse.redirect(
      new URL(`/learn/${String(listing.courseId)}?promo=${code}`, appUrl),
      { status: 302 },
    );
  } catch (err) {
    logger.warn({ err, code }, 'Promo : redirection en repli après erreur');
    return fallback;
  }
}
