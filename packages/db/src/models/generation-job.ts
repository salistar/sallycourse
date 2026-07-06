import {
  Schema,
  model,
  models,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';
import { logEntrySchema, type LogEntry } from './common';

export interface IGenerationJob {
  courseId: Types.ObjectId;
  /** Étape courante du pipeline (outline, scripts, tts, video…). */
  step: string;
  /** Avancement global 0-100. */
  progress: number;
  logs: LogEntry[];
  error?: string;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
}

export type GenerationJobDocument = HydratedDocument<IGenerationJob>;

const generationJobSchema = new Schema<IGenerationJob>(
  {
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    step: { type: String, required: true },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    logs: { type: [logEntrySchema], default: [] },
    error: { type: String },
    attempts: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

export const GenerationJob: Model<IGenerationJob> =
  (models.GenerationJob as Model<IGenerationJob> | undefined) ??
  model<IGenerationJob>('GenerationJob', generationJobSchema);
