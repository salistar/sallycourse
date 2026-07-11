import {
  Schema,
  model,
  models,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';

// Coupons et promotions (Prompt 139). Un coupon appartient à un utilisateur
// (créateur des cours) et s'applique soit au checkout du LMS interne (P43 —
// remise sur LmsListing.priceCents), soit sur Udemy (le code est généré ici
// mais l'inscription réelle du coupon reste manuelle côté dashboard Udemy,
// l'automation Playwright n'exposant pas ce flow de façon fiable — voir
// worker/src/deploy/adapters/udemy.ts:createCoupon).
//
// Une seule des deux remises (discountPercent XOR discountAmount) est
// renseignée — validée applicativement (voir isValidDiscountShape ci-dessous
// et dans @sallycourse/shared/coupon.ts pour la logique de validité pure).

export const COUPON_PLATFORMS = ['internal', 'udemy'] as const;
export type CouponPlatform = (typeof COUPON_PLATFORMS)[number];

export interface ICoupon {
  userId: Types.ObjectId;
  /** Cours ciblé (optionnel : un coupon peut s'appliquer à tout le catalogue de l'utilisateur). */
  courseId?: Types.ObjectId;
  /** Code unique saisi au checkout (ou dans le dashboard Udemy en mode manuel). */
  code: string;
  /** Remise en pourcentage (1-100). Exclusif avec discountAmount. */
  discountPercent?: number;
  /** Remise en centimes (montant fixe). Exclusif avec discountPercent. */
  discountAmount?: number;
  validFrom: Date;
  validUntil: Date;
  /** Nombre maximal d'utilisations (0/undefined = illimité). */
  maxUses?: number;
  /** Compteur d'utilisations — décrémenté atomiquement (findOneAndUpdate) à chaque application. */
  usedCount: number;
  /** LMS interne (application directe au checkout) ou Udemy (code informatif, saisie manuelle). */
  platform: CouponPlatform;
  /** Udemy uniquement : true si le code a été confirmé comme créé côté dashboard Udemy. */
  udemyConfirmed?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type CouponDocument = HydratedDocument<ICoupon>;

const couponSchema = new Schema<ICoupon>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    courseId: { type: Schema.Types.ObjectId, ref: 'Course' },
    code: { type: String, required: true, trim: true, uppercase: true, unique: true },
    discountPercent: { type: Number, min: 1, max: 100 },
    discountAmount: { type: Number, min: 1 },
    validFrom: { type: Date, required: true },
    validUntil: { type: Date, required: true },
    maxUses: { type: Number, min: 0 },
    usedCount: { type: Number, default: 0, min: 0 },
    platform: { type: String, enum: [...COUPON_PLATFORMS], default: 'internal' },
    udemyConfirmed: { type: Boolean, default: false },
  },
  { timestamps: true },
);

couponSchema.index({ userId: 1, createdAt: -1 });

export const Coupon: Model<ICoupon> =
  (models.Coupon as Model<ICoupon> | undefined) ?? model<ICoupon>('Coupon', couponSchema);
