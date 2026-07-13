// Défaut + destructuration : l'export nommé `models` de mongoose (CJS) n'est
// pas détecté par le lexer de Node ESM (worker exécuté via tsx).
import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';

// Tracking granulaire par leçon (Prompt 144) — complète Enrollment (P43) qui ne
// porte que la liste des leçons complétées. Une ligne = l'état d'avancement
// d'un apprenant sur UNE leçon d'un cours, alimentée par les événements du
// player LMS (leçon commencée / terminée, temps passé approximatif, score de
// quiz). Sert de source à la heatmap d'abandon (dropout-heatmap.ts) et à
// l'export xAPI/SCORM.

// Prompt 145 (additif) — détail des questions ratées à la dernière tentative
// de quiz, avec leur thème : alimente le générateur d'exercices personnalisés
// (sélection des thèmes faibles). N'affecte pas le tracking P144 existant.
export interface IWrongAnswer {
  /** Énoncé de la question ratée (contexte, sans re-fetch le Quiz). */
  question: string;
  /** Thème/sujet de la question — sert à cibler les exercices générés. */
  theme: string;
  /** Choix sélectionné par l'étudiant (index). */
  pickedIndex: number;
  /** Bonne réponse (index). */
  correctIndex: number;
}

export interface ILessonProgress {
  enrollmentId: Types.ObjectId;
  courseId: Types.ObjectId;
  lessonId: Types.ObjectId;
  studentId: Types.ObjectId;
  /** Renseigné dès le premier événement "leçon commencée". */
  startedAt?: Date;
  /** Renseigné quand la leçon est marquée terminée. */
  completedAt?: Date;
  /** Temps passé cumulé (approximatif, remonté par le player) en secondes. */
  timeSpentSeconds: number;
  /** Score au quiz de la leçon (0-100), si la leçon est de type quiz. */
  quizScore?: number;
  /** Questions ratées à la dernière tentative de quiz (P145, additif). */
  wrongAnswers?: IWrongAnswer[];
  createdAt: Date;
  updatedAt: Date;
}

export type LessonProgressDocument = HydratedDocument<ILessonProgress>;

const wrongAnswerSchema = new Schema<IWrongAnswer>(
  {
    question: { type: String, required: true },
    theme: { type: String, required: true, trim: true },
    pickedIndex: { type: Number, required: true },
    correctIndex: { type: Number, required: true },
  },
  { _id: false },
);

const lessonProgressSchema = new Schema<ILessonProgress>(
  {
    enrollmentId: { type: Schema.Types.ObjectId, ref: 'Enrollment', required: true, index: true },
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    lessonId: { type: Schema.Types.ObjectId, ref: 'Lesson', required: true, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    startedAt: { type: Date },
    completedAt: { type: Date },
    timeSpentSeconds: { type: Number, default: 0, min: 0 },
    quizScore: { type: Number, min: 0, max: 100 },
    wrongAnswers: { type: [wrongAnswerSchema], default: undefined },
  },
  { timestamps: true },
);

// Une seule ligne de progression par (apprenant, leçon) : upsert idempotent
// depuis le player (chaque événement met à jour la même ligne).
lessonProgressSchema.index({ studentId: 1, lessonId: 1 }, { unique: true });
// Agrégation de la heatmap d'abandon : toutes les lignes d'un cours.
lessonProgressSchema.index({ courseId: 1 });

export const LessonProgress: Model<ILessonProgress> =
  (mongoose.models.LessonProgress as Model<ILessonProgress> | undefined) ??
  model<ILessonProgress>('LessonProgress', lessonProgressSchema);
