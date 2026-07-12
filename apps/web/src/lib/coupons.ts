import {
  applyDiscount,
  atomicRedemptionFilter,
  checkCouponValidity,
  COUPON_INVALID_MESSAGES,
} from '@sallycourse/shared';
import { Coupon, type ICoupon } from '@sallycourse/db';

/**
 * Application d'un coupon au checkout du LMS interne (Prompt 139, P43).
 * Le décrément d'usedCount est ATOMIQUE (findOneAndUpdate avec le même
 * filtre que la validation — voir atomicRedemptionFilter dans
 * @sallycourse/shared/coupon.ts) : deux checkouts concurrents sur le même
 * coupon ne peuvent jamais dépasser maxUses (pas de lecture-puis-écriture).
 */

export interface RedeemCouponResult {
  ok: boolean;
  /** Message utilisateur si le coupon est refusé (ok=false). */
  error?: string;
  /** Prix final (centimes) après remise, présent uniquement si ok=true. */
  priceCents?: number;
  couponId?: string;
}

/**
 * Tente d'appliquer `code` au prix `priceCents` pour le cours `courseId`
 * (optionnel : un coupon peut être global à l'utilisateur créateur du cours).
 * Revalide côté lecture (message d'erreur précis) PUIS effectue la
 * décrémentation atomique — si le document a changé entre les deux (race
 * condition), le findOneAndUpdate renvoie null et l'appelant reçoit un
 * message générique de coupon épuisé (jamais de double-décompte possible).
 */
export async function redeemCoupon(params: {
  code: string;
  priceCents: number;
  courseId?: string;
}): Promise<RedeemCouponResult> {
  const code = params.code.trim().toUpperCase();
  if (!code) return { ok: false, error: 'Code promo manquant.' };

  const coupon = await Coupon.findOne({ code }).lean<ICoupon & { _id: unknown }>();
  if (!coupon) return { ok: false, error: 'Code promo introuvable.' };

  if (params.courseId && coupon.courseId && String(coupon.courseId) !== String(params.courseId)) {
    return { ok: false, error: 'Ce code promo ne s’applique pas à ce cours.' };
  }

  const now = new Date();
  const validity = checkCouponValidity(coupon, now);
  if (!validity.valid) {
    return { ok: false, error: COUPON_INVALID_MESSAGES[validity.reason!] };
  }

  // Décrément atomique : ne réussit que si le coupon est TOUJOURS valide au
  // moment de l'écriture (même filtre que la validité de lecture ci-dessus).
  const updated = await Coupon.findOneAndUpdate(atomicRedemptionFilter(code, now), {
    $inc: { usedCount: 1 },
  });
  if (!updated) {
    return { ok: false, error: COUPON_INVALID_MESSAGES.max_uses_reached };
  }

  const priceCents = applyDiscount(params.priceCents, coupon);
  return { ok: true, priceCents, couponId: String(coupon._id) };
}
