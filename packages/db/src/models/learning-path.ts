// Défaut + destructuration : l'export nommé `models` de mongoose (CJS) n'est
// pas détecté par le lexer de Node ESM (worker exécuté via tsx).
import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';
// @ts-ignore TS2835 — consommé en source (NodeNext côté worker), résolu partout
import type { LearningPathSalesPage } from '@sallycourse/shared/learning-path.js';
import { LMS_CURRENCIES, type LmsCurrency } from './lms-listing';

/**
 * Parcours d'apprentissage / bundle (Prompt 199) : chaîne plusieurs cours DÉJÀ
 * publiés sur le LMS interne (LmsListing.published) en une progression ordonnée
 * avec prérequis. Le parcours ne DUPLIQUE rien : ni le contenu (référence de
 * courseId), ni la progression (dérivée des Enrollment existants), ni le
 * gabarit de certificat. `priceCents`/`currency` = prix bundle, encaissé par le
 * MÊME chemin que les cours (coupon + stub CMI).
 */

export interface ILearningPathCourse {
  courseId: Types.ObjectId;
  /** Rang dans le parcours (0-based, unique par parcours — imposé applicativement). */
  order: number;
  /** true → cours verrouillé tant que le cours précédent n'est pas terminé. */
  requiresPrevious: boolean;
}

export interface ILearningPath {
  /** Auteur du parcours — doit posséder CHAQUE cours listé. */
  userId: Types.ObjectId;
  title: string;
  /** Identifiant d'URL de la page de vente publique (/paths/[slug]). */
  slug: string;
  description: string;
  courses: ILearningPathCourse[];
  /** Prix du bundle en centimes (0 = gratuit) — mêmes devises que LmsListing. */
  priceCents: number;
  currency: LmsCurrency;
  /** Visible dans /learn et sur /paths/[slug] ? */
  published: boolean;
  /** Page de vente générée (learningPathSalesPageSchema) — null tant que non générée. */
  salesPage?: LearningPathSalesPage | null;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type LearningPathDocument = HydratedDocument<ILearningPath>;

const learningPathCourseSchema = new Schema<ILearningPathCourse>(
  {
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    order: { type: Number, required: true, min: 0 },
    requiresPrevious: { type: Boolean, default: false },
  },
  { _id: false },
);

const learningPathSchema = new Schema<ILearningPath>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    description: { type: String, default: '' },
    courses: { type: [learningPathCourseSchema], default: [] },
    priceCents: { type: Number, default: 0, min: 0 },
    currency: { type: String, enum: [...LMS_CURRENCIES], default: 'MAD' },
    published: { type: Boolean, default: false, index: true },
    salesPage: { type: Schema.Types.Mixed, default: null },
    publishedAt: { type: Date },
  },
  { timestamps: true },
);

// Catalogue public : parcours publiés, du plus récent au plus ancien.
learningPathSchema.index({ published: 1, publishedAt: -1 });

export const LearningPath: Model<ILearningPath> =
  (mongoose.models.LearningPath as Model<ILearningPath> | undefined) ??
  model<ILearningPath>('LearningPath', learningPathSchema);
