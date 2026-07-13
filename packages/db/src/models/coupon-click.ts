// Défaut + destructuration : l'export nommé `models` de mongoose (CJS) n'est
// pas détecté par le lexer de Node ESM (worker exécuté via tsx).
import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';

// Tracking des clics sur une page promo trackée /promo/[code] (Prompt 139).
// Simple compteur d'événements (best-effort, jamais bloquant pour la
// redirection) — inspiré du même besoin sur AffiliateLink (clicks bruts).

export interface ICouponClick {
  couponId: Types.ObjectId;
  code: string;
  /** IP éventuellement tronquée / user-agent — best-effort, aucune donnée sensible requise. */
  userAgent?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type CouponClickDocument = HydratedDocument<ICouponClick>;

const couponClickSchema = new Schema<ICouponClick>(
  {
    couponId: { type: Schema.Types.ObjectId, ref: 'Coupon', required: true, index: true },
    code: { type: String, required: true, trim: true, uppercase: true, index: true },
    userAgent: { type: String, maxlength: 300 },
  },
  { timestamps: true },
);

couponClickSchema.index({ code: 1, createdAt: -1 });

export const CouponClick: Model<ICouponClick> =
  (mongoose.models.CouponClick as Model<ICouponClick> | undefined) ??
  model<ICouponClick>('CouponClick', couponClickSchema);
