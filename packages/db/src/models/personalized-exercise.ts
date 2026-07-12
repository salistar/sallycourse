import {
  Schema,
  model,
  models,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';
// prettier-ignore
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext) ; typage intact ici (Bundler)
import { QUIZ, difficultySchema, type QuizQuestion } from '@sallycourse/shared';

/**
 * Exercices supplémentaires générés à la demande d'un étudiant (Prompt 145) —
 * bouton « Plus d'exercices » du LMS interne. Stockage DÉLIBÉRÉMENT séparé du
 * Quiz officiel du cours (packages/db/src/models/quiz.ts) : ce sont des
 * variantes ciblées sur les points faibles PERSONNELS de cet étudiant, elles
 * ne doivent jamais polluer le quiz vu par les autres apprenants ni l'édition
 * du cours par le formateur.
 */

export interface IPersonalizedExercise {
  studentId: Types.ObjectId;
  lessonId: Types.ObjectId;
  courseId: Types.ObjectId;
  /** Thèmes ciblés (dérivés des questions ratées) ayant motivé la génération. */
  targetedThemes: string[];
  /** Questions générées — même forme que le quiz officiel (réutilise QuizPreview). */
  questions: QuizQuestion[];
  createdAt: Date;
}

export type PersonalizedExerciseDocument = HydratedDocument<IPersonalizedExercise>;

const personalizedQuestionSchema = new Schema<QuizQuestion>(
  {
    question: { type: String, required: true, trim: true },
    choices: {
      type: [String],
      required: true,
      validate: {
        validator: (v: string[]) => v.length === QUIZ.CHOICES_PER_QUESTION,
        message: `chaque question doit avoir exactement ${QUIZ.CHOICES_PER_QUESTION} choix`,
      },
    },
    correctIndex: {
      type: Number,
      required: true,
      min: 0,
      max: QUIZ.CHOICES_PER_QUESTION - 1,
    },
    explanation: { type: String, default: '' },
    difficulty: { type: String, enum: [...difficultySchema.options], default: 'beginner' },
  },
  { _id: false },
);

const personalizedExerciseSchema = new Schema<IPersonalizedExercise>({
  studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  lessonId: { type: Schema.Types.ObjectId, ref: 'Lesson', required: true, index: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
  targetedThemes: { type: [String], default: [] },
  questions: { type: [personalizedQuestionSchema], default: [] },
  createdAt: { type: Date, default: Date.now },
});

// Historique des générations par (apprenant, leçon), le plus récent en tête.
personalizedExerciseSchema.index({ studentId: 1, lessonId: 1, createdAt: -1 });

export const PersonalizedExercise: Model<IPersonalizedExercise> =
  (models.PersonalizedExercise as Model<IPersonalizedExercise> | undefined) ??
  model<IPersonalizedExercise>('PersonalizedExercise', personalizedExerciseSchema);
