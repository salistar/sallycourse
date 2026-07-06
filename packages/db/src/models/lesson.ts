import {
  Schema,
  model,
  models,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';
import { lessonTypeSchema, type LessonType } from '@sallycourse/shared';

export const LESSON_STATUSES = ['pending', 'generating', 'ready', 'failed'] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

export interface ILessonAssets {
  videoUrl?: string;
  articleMd?: string;
  screenshots: string[];
  srtUrl?: string;
  vttUrl?: string;
  audioUrl?: string;
}

export interface ILesson {
  sectionId: Types.ObjectId;
  courseId: Types.ObjectId;
  order: number;
  title: string;
  type: LessonType;
  status: LessonStatus;
  durationMin?: number;
  summary?: string;
  /** Script de génération (structure libre, produite par le worker). */
  script?: unknown;
  assets: ILessonAssets;
  /** Hash du contenu source — évite de regénérer un asset identique. */
  contentHash?: string;
}

export type LessonDocument = HydratedDocument<ILesson>;

const lessonSchema = new Schema<ILesson>({
  sectionId: { type: Schema.Types.ObjectId, ref: 'Section', required: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
  order: { type: Number, required: true, min: 0 },
  title: { type: String, required: true, trim: true },
  type: { type: String, enum: [...lessonTypeSchema.options], required: true },
  status: { type: String, enum: [...LESSON_STATUSES], default: 'pending' },
  durationMin: { type: Number, min: 0 },
  summary: { type: String },
  script: { type: Schema.Types.Mixed, default: null },
  assets: {
    videoUrl: { type: String },
    articleMd: { type: String },
    screenshots: { type: [String], default: [] },
    srtUrl: { type: String },
    vttUrl: { type: String },
    audioUrl: { type: String },
  },
  contentHash: { type: String },
});

lessonSchema.index({ sectionId: 1, order: 1 });

export const Lesson: Model<ILesson> =
  (models.Lesson as Model<ILesson> | undefined) ?? model<ILesson>('Lesson', lessonSchema);
