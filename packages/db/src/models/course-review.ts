// Défaut + destructuration : l'export nommé `models` de mongoose (CJS) n'est
// pas détecté par le lexer de Node ESM (worker exécuté via tsx).
import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';

/**
 * Avis RÉEL d'un apprenant du LMS interne sur un cours (Prompt 205). Seul un
 * étudiant INSCRIT (Enrollment) peut en déposer un, et un seul par cours
 * (index unique) — un nouvel envoi met à jour le précédent.
 *
 * C'est l'UNIQUE source d'avis affichée publiquement (page instructeur). Les
 * « avis Udemy » manipulés par le worker (deploy/feedback-loop.ts) sont MOCKÉS
 * — Udemy n'expose aucune API d'authoring — et ne doivent jamais être présentés
 * comme des avis publics réels.
 */

export interface ICourseReview {
  courseId: Types.ObjectId;
  /** Apprenant auteur de l'avis (doit être inscrit au cours). */
  studentId: Types.ObjectId;
  /** Note 1–5 (obligatoire — un avis est d'abord une note). */
  rating: number;
  /** Commentaire public facultatif (affiché avec « Prénom I. »). */
  comment?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type CourseReviewDocument = HydratedDocument<ICourseReview>;

const courseReviewSchema = new Schema<ICourseReview>(
  {
    // Pas d'`index: true` ici : l'index composé {courseId, createdAt} ci-dessous
    // porte déjà courseId en préfixe (un index simple ferait doublon).
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true, maxlength: 600 },
  },
  { timestamps: true },
);

// Un seul avis par (apprenant, cours) — le re-dépôt est un update, pas un doublon.
courseReviewSchema.index({ studentId: 1, courseId: 1 }, { unique: true });
// Agrégation de la page instructeur : avis des cours d'un auteur, du plus récent au plus ancien.
courseReviewSchema.index({ courseId: 1, createdAt: -1 });

export const CourseReview: Model<ICourseReview> =
  (mongoose.models.CourseReview as Model<ICourseReview> | undefined) ??
  model<ICourseReview>('CourseReview', courseReviewSchema);
