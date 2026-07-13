// Défaut + destructuration : l'export nommé `models` de mongoose (CJS) n'est
// pas détecté par le lexer de Node ESM (worker exécuté via tsx).
import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';

// Témoignage optionnel associé à un cours affiché sur la vitrine publique
// (Prompt 89, /showcase). Créé quand l'auteur active Course.showcaseOptIn et
// choisit d'ajouter un mot ; la vitrine peut aussi afficher un cours en
// opt-in sans témoignage.

export interface ITestimonial {
  userId: Types.ObjectId;
  courseId: Types.ObjectId;
  /** Citation courte de l'auteur du cours à propos de son expérience. */
  quote: string;
  /** Note 1–5 (facultative — un témoignage peut n'être qu'un texte). */
  rating?: number;
  createdAt: Date;
  updatedAt: Date;
}

export type TestimonialDocument = HydratedDocument<ITestimonial>;

const testimonialSchema = new Schema<ITestimonial>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, unique: true },
    quote: { type: String, required: true, trim: true, maxlength: 600 },
    rating: { type: Number, min: 1, max: 5 },
  },
  { timestamps: true },
);

testimonialSchema.index({ createdAt: -1 });

export const Testimonial: Model<ITestimonial> =
  (mongoose.models.Testimonial as Model<ITestimonial> | undefined) ??
  model<ITestimonial>('Testimonial', testimonialSchema);
