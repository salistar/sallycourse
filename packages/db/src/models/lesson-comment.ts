import {
  Schema,
  model,
  models,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';

// Commentaire d'équipe sur une leçon (Prompt 138, contexte Workspace). Simple
// fil de discussion — pas d'édition/suppression pour rester minimal (v1) ;
// visible uniquement quand le cours parent appartient à un Workspace (UI
// masquée sinon, cf. LessonPanel côté web).

export interface ILessonComment {
  lessonId: Types.ObjectId;
  userId: Types.ObjectId;
  text: string;
  createdAt: Date;
  updatedAt: Date;
}

export type LessonCommentDocument = HydratedDocument<ILessonComment>;

const lessonCommentSchema = new Schema<ILessonComment>(
  {
    lessonId: { type: Schema.Types.ObjectId, ref: 'Lesson', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, trim: true, maxlength: 4000 },
  },
  { timestamps: true },
);

// Fil de commentaires d'une leçon, du plus ancien au plus récent.
lessonCommentSchema.index({ lessonId: 1, createdAt: 1 });

export const LessonComment: Model<ILessonComment> =
  (models.LessonComment as Model<ILessonComment> | undefined) ??
  model<ILessonComment>('LessonComment', lessonCommentSchema);
