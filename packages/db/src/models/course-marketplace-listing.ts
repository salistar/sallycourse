import {
  Schema,
  model,
  models,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';

// Marketplace de cours entre utilisateurs (Prompt 147) : un créateur liste soit
// une copie intégrale de son cours généré (licenseType='course-copy' — outline +
// sections + leçons + assets dupliqués à l'achat, réutilise la logique de P64
// sans re-générer via LLM), soit uniquement son plan/template (licenseType=
// 'template-only' — réutilise DeployPreset.templateRefs ou l'outline seul,
// l'acheteur régénère lui-même le contenu). Achat = duplication du Course
// (voir worker/src/lib/marketplace-purchase.ts), jamais un accès partagé au
// cours source. Le paiement réutilise le pipeline CMI/Paddle existant (P54) ;
// la commission plateforme est calculée en centimes (voir
// packages/shared/src/marketplace.ts, calcul PUR testé isolément).

export const MARKETPLACE_LICENSE_TYPES = ['course-copy', 'template-only'] as const;
export type MarketplaceLicenseType = (typeof MARKETPLACE_LICENSE_TYPES)[number];

export const MARKETPLACE_LISTING_STATUSES = ['active', 'paused', 'removed'] as const;
export type MarketplaceListingStatus = (typeof MARKETPLACE_LISTING_STATUSES)[number];

export interface ICourseMarketplaceListing {
  /** Cours source à dupliquer (course-copy) ou dont l'outline sert de template (template-only). */
  courseId: Types.ObjectId;
  /** Créateur/vendeur — reçoit le revenu net (prix - commission plateforme). */
  sellerId: Types.ObjectId;
  /** Prix de vente en centimes (0 = gratuit, duplication immédiate sans paiement). */
  priceCents: number;
  currency: string;
  licenseType: MarketplaceLicenseType;
  /** Description marketing affichée sur la fiche du catalogue marketplace. */
  description: string;
  /** Catégorie libre pour le filtrage du catalogue (ex. "Développement", "Marketing"). */
  category?: string;
  /** Taux de commission plateforme appliqué à CETTE vente (0.2 = 20%), figé à la création du listing. */
  platformFeeRate: number;
  status: MarketplaceListingStatus;
  /** Compteurs dénormalisés — mis à jour à chaque achat confirmé. */
  salesCount: number;
  /** Revenu net cumulé du vendeur (centimes), hors commission. */
  netRevenueCents: number;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type CourseMarketplaceListingDocument = HydratedDocument<ICourseMarketplaceListing>;

const courseMarketplaceListingSchema = new Schema<ICourseMarketplaceListing>(
  {
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    sellerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    priceCents: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: 'MAD', trim: true },
    licenseType: { type: String, enum: [...MARKETPLACE_LICENSE_TYPES], required: true },
    description: { type: String, default: '', maxlength: 2000 },
    category: { type: String, trim: true },
    // 20% par défaut (cohérent avec la commission d'affiliation DEFAULT_COMMISSION_RATE).
    platformFeeRate: { type: Number, default: 0.2, min: 0, max: 1 },
    status: { type: String, enum: [...MARKETPLACE_LISTING_STATUSES], default: 'active' },
    salesCount: { type: Number, default: 0, min: 0 },
    netRevenueCents: { type: Number, default: 0, min: 0 },
    publishedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);

// Catalogue public : listings actifs, du plus récent au plus ancien, filtrable par catégorie.
courseMarketplaceListingSchema.index({ status: 1, category: 1, publishedAt: -1 });
// Listings d'un vendeur (dashboard).
courseMarketplaceListingSchema.index({ sellerId: 1, createdAt: -1 });

export const CourseMarketplaceListing: Model<ICourseMarketplaceListing> =
  (models.CourseMarketplaceListing as Model<ICourseMarketplaceListing> | undefined) ??
  model<ICourseMarketplaceListing>('CourseMarketplaceListing', courseMarketplaceListingSchema);
