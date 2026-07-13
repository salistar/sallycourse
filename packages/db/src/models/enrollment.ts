// Défaut + destructuration : l'export nommé `models` de mongoose (CJS) n'est
// pas détecté par le lexer de Node ESM (worker exécuté via tsx).
import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';

// Inscription d'un apprenant à un cours du LMS interne (Prompt 43). Porte la
// progression par leçon (leçons complétées) et la date de complétion globale
// (déclenche l'émission du certificat PDF). Un seul enrollment par
// (studentId, courseId) — l'index unique évite les doublons.

export interface IEnrollment {
  /** Apprenant inscrit (compte User). */
  studentId: Types.ObjectId;
  courseId: Types.ObjectId;
  /** Ids des leçons marquées terminées (dédupliqués applicativement). */
  completedLessons: Types.ObjectId[];
  /** Titre figé du cours au moment de l'inscription (affichage « mes cours »). */
  courseTitle: string;
  /** Renseignée quand toutes les leçons sont complétées → certificat émis. */
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type EnrollmentDocument = HydratedDocument<IEnrollment>;

const enrollmentSchema = new Schema<IEnrollment>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    completedLessons: { type: [Schema.Types.ObjectId], default: [] },
    courseTitle: { type: String, default: '' },
    completedAt: { type: Date },
  },
  { timestamps: true },
);

// Un seul enrollment par (apprenant, cours) : ré-inscription = no-op côté API.
enrollmentSchema.index({ studentId: 1, courseId: 1 }, { unique: true });

export const Enrollment: Model<IEnrollment> =
  (mongoose.models.Enrollment as Model<IEnrollment> | undefined) ??
  model<IEnrollment>('Enrollment', enrollmentSchema);
