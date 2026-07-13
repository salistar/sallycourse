// Défaut + destructuration : l'export nommé `models` de mongoose (CJS) n'est
// pas détecté par le lexer de Node ESM (worker exécuté via tsx).
import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';

// Entrée catalogue du LMS interne SallyCourse (Prompt 43). Publier un cours sur
// le LMS interne = créer/mettre à jour ce document (le contenu réel reste en
// base/stockage : aucune copie). `published` pilote la visibilité publique dans
// /learn ; le prix (centimes) est un STUB pour le paiement CMI branché en Phase 4.

/** Devise du catalogue — MAD par défaut (paiement CMI, Maroc). */
export const LMS_CURRENCIES = ['MAD', 'EUR', 'USD'] as const;
export type LmsCurrency = (typeof LMS_CURRENCIES)[number];

export interface ILmsListing {
  courseId: Types.ObjectId;
  /** Propriétaire (auteur du cours) — pour les stats et l'ownership. */
  userId: Types.ObjectId;
  /** Titre figé au moment de la publication (repris du cours). */
  title: string;
  /** Résumé marketing court affiché dans le catalogue. */
  summary: string;
  /** Clé S3 de l'image de couverture (présignée à l'affichage). */
  coverImageKey?: string;
  /** Visible dans /learn ? Dé-publier = repasser à false (contenu conservé). */
  published: boolean;
  /**
   * Prix en centimes (0 = gratuit). STUB : la facturation CMI n'est branchée
   * qu'en Phase 4 ; tant que free ou mock, l'inscription est immédiate.
   */
  priceCents: number;
  currency: LmsCurrency;
  /** Compteurs dénormalisés (nb leçons, durée) figés à la publication. */
  lessonCount: number;
  durationMin: number;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type LmsListingDocument = HydratedDocument<ILmsListing>;

const lmsListingSchema = new Schema<ILmsListing>(
  {
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true },
    summary: { type: String, default: '' },
    coverImageKey: { type: String },
    published: { type: Boolean, default: false, index: true },
    priceCents: { type: Number, default: 0, min: 0 },
    currency: { type: String, enum: [...LMS_CURRENCIES], default: 'MAD' },
    lessonCount: { type: Number, default: 0, min: 0 },
    durationMin: { type: Number, default: 0, min: 0 },
    publishedAt: { type: Date },
  },
  { timestamps: true },
);

// Catalogue public : listing des cours publiés, du plus récent au plus ancien.
lmsListingSchema.index({ published: 1, publishedAt: -1 });

export const LmsListing: Model<ILmsListing> =
  (mongoose.models.LmsListing as Model<ILmsListing> | undefined) ??
  model<ILmsListing>('LmsListing', lmsListingSchema);
