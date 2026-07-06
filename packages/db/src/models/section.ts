// Défaut + destructuration : l'export nommé `models` de mongoose (CJS) n'est
// pas détecté par le lexer de Node ESM (worker exécuté via tsx).
import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';

export interface ISection {
  courseId: Types.ObjectId;
  order: number;
  title: string;
}

export type SectionDocument = HydratedDocument<ISection>;

const sectionSchema = new Schema<ISection>({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
  order: { type: Number, required: true, min: 0 },
  title: { type: String, required: true, trim: true },
});

// Une seule section par position dans un cours.
sectionSchema.index({ courseId: 1, order: 1 }, { unique: true });

export const Section: Model<ISection> =
  (mongoose.models.Section as Model<ISection> | undefined) ?? model<ISection>('Section', sectionSchema);
