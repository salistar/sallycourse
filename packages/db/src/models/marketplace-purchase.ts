// Défaut + destructuration : l'export nommé `models` de mongoose (CJS) n'est
// pas détecté par le lexer de Node ESM (worker exécuté via tsx).
import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';

// Transaction d'achat marketplace (Prompt 147) : trace chaque achat confirmé
// (idempotence via providerRef), le partage de revenu figé au moment de la
// vente et la référence du cours dupliqué livré à l'acheteur. Un buyer peut
// racheter un même listing (nouvelle copie) — pas de contrainte d'unicité
// stricte, mais on retrouve l'historique par (buyerId, listingId).

export interface ICourseMarketplacePurchase {
  listingId: Types.ObjectId;
  /** Cours source au moment de l'achat (dénormalisé — le listing peut être retiré ensuite). */
  sourceCourseId: Types.ObjectId;
  sellerId: Types.ObjectId;
  buyerId: Types.ObjectId;
  /** Cours livré à l'acheteur — copie indépendante (course-copy) ou null (template-only sans duplication de contenu). */
  deliveredCourseId?: Types.ObjectId | null;
  priceCents: number;
  currency: string;
  /** Commission plateforme prélevée (centimes), calculée à partir de platformFeeRate figé sur le listing. */
  platformFeeCents: number;
  /** Revenu net crédité au vendeur (priceCents - platformFeeCents). */
  sellerNetCents: number;
  /** Fournisseur de paiement ayant confirmé la transaction (réutilise P54) ; 'free' si prix nul. */
  provider: 'cmi' | 'paddle' | 'mock' | 'free';
  /** Référence du paiement provider — clé d'idempotence (jamais rejouée deux fois). */
  providerRef: string;
  createdAt: Date;
  updatedAt: Date;
}

export type CourseMarketplacePurchaseDocument = HydratedDocument<ICourseMarketplacePurchase>;

const courseMarketplacePurchaseSchema = new Schema<ICourseMarketplacePurchase>(
  {
    listingId: { type: Schema.Types.ObjectId, ref: 'CourseMarketplaceListing', required: true, index: true },
    sourceCourseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    sellerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    buyerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    deliveredCourseId: { type: Schema.Types.ObjectId, ref: 'Course', default: null },
    priceCents: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'MAD', trim: true },
    platformFeeCents: { type: Number, required: true, min: 0 },
    sellerNetCents: { type: Number, required: true, min: 0 },
    provider: { type: String, enum: ['cmi', 'paddle', 'mock', 'free'], required: true },
    providerRef: { type: String, required: true, trim: true },
  },
  { timestamps: true },
);

// Idempotence : une même référence provider ne peut être capturée deux fois.
courseMarketplacePurchaseSchema.index({ providerRef: 1 }, { unique: true });
courseMarketplacePurchaseSchema.index({ buyerId: 1, createdAt: -1 });

export const CourseMarketplacePurchase: Model<ICourseMarketplacePurchase> =
  (mongoose.models.CourseMarketplacePurchase as Model<ICourseMarketplacePurchase> | undefined) ??
  model<ICourseMarketplacePurchase>('CourseMarketplacePurchase', courseMarketplacePurchaseSchema);
