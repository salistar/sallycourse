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
 * Historique des versions de contenu éditable d'une leçon (P131) — distinct
 * de Lesson.versions (empreintes de contenu diffusable côté worker) : ici on
 * stocke un instantané complet du contenu ÉDITÉ (Markdown, script de slides,
 * questions de quiz…) pour permettre un diff simple et une restauration
 * depuis l'UI « Historique » de la leçon. Une version est créée avant
 * chaque édition significative (sauvegarde manuelle ou snapshot périodique),
 * jamais à chaque frappe.
 */
// Nommage distinct de ILessonVersion (packages/db/src/models/lesson.ts, P46) :
// cette dernière est une empreinte légère de contenu diffusable embarquée dans
// Lesson.versions ; ICI on stocke un instantané complet du contenu ÉDITÉ dans
// sa propre collection — même racine sémantique, mais deux entités distinctes,
// d'où le suffixe Snapshot pour éviter toute ambiguïté d'export du baril.
export interface ILessonVersionSnapshot {
  lessonId: Types.ObjectId;
  /** Contenu libre : { articleMd } | { script } | { questions } selon le type de leçon. */
  snapshot: unknown;
  createdAt: Date;
  /** Étiquette optionnelle (ex. « avant régénération », « édition manuelle »). */
  label?: string;
}

export type LessonVersionDocument = HydratedDocument<ILessonVersionSnapshot>;

const lessonVersionSchema = new Schema<ILessonVersionSnapshot>({
  lessonId: { type: Schema.Types.ObjectId, ref: 'Lesson', required: true, index: true },
  snapshot: { type: Schema.Types.Mixed, required: true },
  createdAt: { type: Date, default: Date.now },
  label: { type: String },
});

lessonVersionSchema.index({ lessonId: 1, createdAt: -1 });

export const LessonVersion: Model<ILessonVersionSnapshot> =
  (mongoose.models.LessonVersion as Model<ILessonVersionSnapshot> | undefined) ??
  model<ILessonVersionSnapshot>('LessonVersion', lessonVersionSchema);
