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
 * Inscription d'un apprenant à un PARCOURS (Prompt 199). Volontairement
 * minimal : la progression n'est PAS stockée ici — elle se dérive des
 * Enrollment (un par cours du parcours, créés en upsert à l'inscription).
 * `completedAt` n'est posée que lorsque TOUS les cours du parcours sont
 * terminés, et l'_id de ce document sert d'identifiant de vérification du
 * certificat de parcours (/verify/[certificateId]), exactement comme l'_id
 * d'un Enrollment pour un certificat de cours.
 */

export interface IPathEnrollment {
  studentId: Types.ObjectId;
  pathId: Types.ObjectId;
  /** Renseignée quand tous les cours du parcours sont complétés → certificat émis. */
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type PathEnrollmentDocument = HydratedDocument<IPathEnrollment>;

const pathEnrollmentSchema = new Schema<IPathEnrollment>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    pathId: { type: Schema.Types.ObjectId, ref: 'LearningPath', required: true, index: true },
    completedAt: { type: Date },
  },
  { timestamps: true },
);

// Une seule inscription par (apprenant, parcours) : ré-inscription = no-op côté API.
pathEnrollmentSchema.index({ studentId: 1, pathId: 1 }, { unique: true });

export const PathEnrollment: Model<IPathEnrollment> =
  (mongoose.models.PathEnrollment as Model<IPathEnrollment> | undefined) ??
  model<IPathEnrollment>('PathEnrollment', pathEnrollmentSchema);
