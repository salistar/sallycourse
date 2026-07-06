import {
  Schema,
  model,
  models,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';
import {
  LOCALES,
  courseStatusSchema,
  difficultySchema,
  outlineSchema,
  type CourseStatus,
  type Difficulty,
  type Locale,
  type Outline,
} from '@sallycourse/shared';

export interface ICourse {
  userId: Types.ObjectId;
  title: string;
  difficulty: Difficulty;
  status: CourseStatus;
  /** Plan de cours — Mixed en base mais validé par outlineSchema (Zod). */
  outline?: Outline | null;
  targetPlatforms: string[];
  locale: Locale;
  ttsVoice?: string;
  coverImageUrl?: string;
  qaReport?: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export type CourseDocument = HydratedDocument<ICourse>;

const courseSchema = new Schema<ICourse>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true },
    difficulty: { type: String, enum: [...difficultySchema.options], required: true },
    status: { type: String, enum: [...courseStatusSchema.options], default: 'draft' },
    outline: {
      type: Schema.Types.Mixed,
      default: null,
      validate: {
        validator: (v: unknown) => v == null || outlineSchema.safeParse(v).success,
        message: 'outline invalide (ne respecte pas outlineSchema)',
      },
    },
    targetPlatforms: { type: [String], default: [] },
    locale: { type: String, enum: [...LOCALES], default: 'fr' },
    ttsVoice: { type: String },
    coverImageUrl: { type: String },
    qaReport: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

// Listing des cours d'un utilisateur, du plus récent au plus ancien.
courseSchema.index({ userId: 1, createdAt: -1 });

export const Course: Model<ICourse> =
  (models.Course as Model<ICourse> | undefined) ?? model<ICourse>('Course', courseSchema);
