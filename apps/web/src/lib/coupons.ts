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
  /**
   * Auteur du contenu remisé (cours ou parcours). Un coupon n'est accepté que
   * s'il appartient à CET auteur : sans ce contrôle, n'importe quel apprenant
   * pouvait s'auto-émettre un coupon global à 100 % (POST /api/coupons) et
   * l'appliquer au contenu payant d'un tiers. Un coupon global reste légitime —
   * c'est la promo de l'auteur sur SON propre catalogue.
   */
  ownerId: string;
  courseId?: string;
  /**
   * true → seuls les coupons GLOBAUX (sans courseId) sont acceptés. Utilisé par
   * le checkout d'un parcours (P199) : un coupon lié à un cours précis ne doit
   * pas remiser le prix bundle de tout un parcours.
   */
  globalOnly?: boolean;
}): Promise<RedeemCouponResult> {
  const code = params.code.trim().toUpperCase();
  if (!code) return { ok: false, error: 'Code promo manquant.' };

  const coupon = await Coupon.findOne({ code }).lean<ICoupon & { _id: unknown }>();
  if (!coupon) return { ok: false, error: 'Code promo introuvable.' };

  // Un coupon ne peut remiser QUE le contenu de son propre créateur.
  if (String(coupon.userId) !== String(params.ownerId)) {
    return { ok: false, error: 'Ce code promo ne s’applique pas à ce contenu.' };
  }
  if (params.globalOnly && coupon.courseId) {
    return { ok: false, error: 'Ce code promo ne s’applique pas à ce parcours.' };
  }
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
