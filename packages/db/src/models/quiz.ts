// Défaut + destructuration : l'export nommé `models` de mongoose (CJS) n'est
// pas détecté par le lexer de Node ESM (worker exécuté via tsx).
import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';
// prettier-ignore
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext) ; typage intact ici (Bundler)
import { QUIZ, difficultySchema, type QuizQuestion } from '@sallycourse/shared';

export interface IQuiz {
  lessonId: Types.ObjectId;
  sectionId: Types.ObjectId;
  courseId: Types.ObjectId;
  questions: QuizQuestion[];
}

export type QuizDocument = HydratedDocument<IQuiz>;

const questionSchema = new Schema<QuizQuestion>(
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

const quizSchema = new Schema<IQuiz>({
  lessonId: { type: Schema.Types.ObjectId, ref: 'Lesson', required: true },
  sectionId: { type: Schema.Types.ObjectId, ref: 'Section', required: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
  questions: { type: [questionSchema], default: [] },
});

export const Quiz: Model<IQuiz> =
  (mongoose.models.Quiz as Model<IQuiz> | undefined) ?? model<IQuiz>('Quiz', quizSchema);
