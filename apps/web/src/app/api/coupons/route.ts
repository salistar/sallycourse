import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import {
  generateUniqueCouponCode,
  hasValidDiscountShape,
  isValidCouponCodeShape,
} from '@sallycourse/shared';
import { connectDb, Coupon, Course, COUPON_PLATFORMS } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';

/**
 * /api/coupons — coupons et promotions (Prompt 139).
 * GET  : coupons de l'utilisateur connecté (plus récents en premier).
 * POST : crée un coupon — { code?, courseId?, discountPercent? XOR discountAmount?,
 *        validFrom, validUntil, maxUses?, platform? }. `code` auto-généré si absent.
 */

export const dynamic = 'force-dynamic';

const createSchema = z
  .object({
    code: z.string().trim().min(3).max(32).optional(),
    courseId: z.string().trim().optional(),
    discountPercent: z.number().int().min(1).max(100).optional(),
    discountAmount: z.number().int().min(1).optional(),
    validFrom: z.coerce.date(),
    validUntil: z.coerce.date(),
    maxUses: z.number().int().min(0).optional(),
    platform: z.enum(COUPON_PLATFORMS as unknown as [string, ...string[]]).optional().default('internal'),
  })
  .refine((v) => hasValidDiscountShape(v), {
    message: 'Fournir exactement une remise : discountPercent OU discountAmount.',
  })
  .refine((v) => v.validUntil > v.validFrom, {
    message: 'validUntil doit être postérieure à validFrom.',
  });

function toPublicCoupon(doc: {
  _id: unknown;
  code: string;
  courseId?: unknown;
  discountPercent?: number;
  discountAmount?: number;
  validFrom: Date;
  validUntil: Date;
  maxUses?: number;
  usedCount: number;
  platform: string;
  udemyConfirmed?: boolean;
  createdAt: Date;
}) {
  return {
    id: String(doc._id),
    code: doc.code,
    courseId: doc.courseId ? String(doc.courseId) : null,
    discountPercent: doc.discountPercent ?? null,
    discountAmount: doc.discountAmount ?? null,
    validFrom: doc.validFrom,
    validUntil: doc.validUntil,
    maxUses: doc.maxUses ?? null,
    usedCount: doc.usedCount,
    platform: doc.platform,
    udemyConfirmed: doc.udemyConfirmed ?? false,
    createdAt: doc.createdAt,
  };
}

export async function GET() {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  await connectDb();
  const coupons = await Coupon.find({ userId: user.id }).sort({ createdAt: -1 }).lean();
  return NextResponse.json({ coupons: coupons.map(toPublicCoupon) });
}

export async function POST(request: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('invalidJson');
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Données invalides.', code: 'invalidData', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  if (parsed.data.courseId && !isValidObjectId(parsed.data.courseId)) {
    return apiError('invalidCourseId');
  }

  await connectDb();

  // Durcissement (L3 audit) : un coupon ciblant un cours ne peut viser QUE l'un
  // des cours du créateur. Sans ce contrôle, on pourrait créer un coupon sur le
  // cours d'un autre auteur (courseId arbitraire). On répond « introuvable »
  // (jamais 403) pour ne pas divulguer l'existence des cours d'autrui.
  if (parsed.data.courseId) {
    const owns = await Course.exists({ _id: parsed.data.courseId, userId: user.id });
    if (!owns) {
      return apiError('courseNotFound');
    }
  }

  let code = parsed.data.code?.trim().toUpperCase();
  if (code) {
    if (!isValidCouponCodeShape(code)) {
      return NextResponse.json({ error: 'Format de code promo invalide.', code: 'invalidPromoCodeFormat' }, { status: 400 });
    }
    const exists = await Coupon.exists({ code });
    if (exists) {
      return NextResponse.json({ error: 'Ce code promo existe déjà.', code: 'promoCodeAlreadyExists' }, { status: 409 });
    }
  } else {
    code = await generateUniqueCouponCode(async (candidate) => Boolean(await Coupon.exists({ code: candidate })));
  }

  const doc = await Coupon.create({
    userId: user.id,
    courseId: parsed.data.courseId,
    code,
    discountPercent: parsed.data.discountPercent,
    discountAmount: parsed.data.discountAmount,
    validFrom: parsed.data.validFrom,
    validUntil: parsed.data.validUntil,
    maxUses: parsed.data.maxUses,
    platform: parsed.data.platform,
  });

  return NextResponse.json({ coupon: toPublicCoupon(doc) }, { status: 201 });
}
