// Défaut + destructuration : l'export nommé `models` de mongoose (CJS) n'est
// pas détecté par le lexer de Node ESM (worker exécuté via tsx).
import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';

// A/B testing des landing pages (Prompt 87). Réutilise les 5 variantes de
// titre déjà générées par le marketing du cours (marketingSchema.titleIdeas,
// P28) : chaque variante devient une ligne LandingVariant testable sur une
// plateforme donnée. Une rotation round-robin (cron BullMQ repeatable,
// ab-testing.ts) active une variante à la fois et l'applique sur la
// plateforme via l'adapter (setLandingPage) si celui-ci le supporte. La
// performance (impressions/conversions) est comparée via CourseAnalytics
// (P61) : le taux de conversion approché = enrollments / impressions.

export interface ILandingVariant {
  courseId: Types.ObjectId;
  /** Propriétaire du cours (dénormalisé pour filtrer sans jointure). */
  userId: Types.ObjectId;
  /** Plateforme testée (udemy, youtube…). */
  platform: string;
  /** Index de la variante dans marketingSchema.titleIdeas (0-based). */
  variantIndex: number;
  title: string;
  subtitle?: string;
  description: string;
  /** Une seule variante active à la fois par (cours, plateforme). */
  isActive: boolean;
  /** Impressions estimées cumulées depuis l'activation (proxy = vues/visites). */
  impressions: number;
  /** Conversions estimées cumulées (proxy = inscrits pendant la période active). */
  conversions: number;
  /** Dernière fois que cette variante a été activée sur la plateforme. */
  lastActivatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type LandingVariantDocument = HydratedDocument<ILandingVariant>;

const landingVariantSchema = new Schema<ILandingVariant>(
  {
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    platform: { type: String, required: true, trim: true },
    variantIndex: { type: Number, required: true, min: 0 },
    title: { type: String, required: true, trim: true },
    subtitle: { type: String, trim: true },
    description: { type: String, required: true },
    isActive: { type: Boolean, default: false },
    impressions: { type: Number, default: 0, min: 0 },
    conversions: { type: Number, default: 0, min: 0 },
    lastActivatedAt: { type: Date },
  },
  { timestamps: true },
);

// Une variante par (cours, plateforme, index) — upsert idempotent à la création.
landingVariantSchema.index({ courseId: 1, platform: 1, variantIndex: 1 }, { unique: true });

export const LandingVariant: Model<ILandingVariant> =
  (mongoose.models.LandingVariant as Model<ILandingVariant> | undefined) ??
  model<ILandingVariant>('LandingVariant', landingVariantSchema);
