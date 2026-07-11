// Défaut + destructuration : l'export nommé `models` de mongoose (CJS) n'est
// pas détecté par le lexer de Node ESM (worker exécuté via tsx).
import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';
// @ts-ignore TS2835 — import sans extension, consommé en source par le worker (NodeNext)
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
  /**
   * Checkpoints de reprise granulaire (P69) : { [jobId]: CheckpointEntry[] }.
   * jobId = identifiant stable de l'item en cours (ex. lessonId) ; permet à
   * withCheckpoint (worker/src/lib/idempotency.ts) de reprendre une boucle
   * multi-items (slides TTS, étapes de capture…) exactement où elle s'est
   * arrêtée après un crash, sans retraiter les items déjà faits. Purgé une
   * fois tous les items traités.
   */
  checkpoint?: Record<string, unknown>;
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
    checkpoint: { type: Schema.Types.Mixed, default: undefined },
  },
  { timestamps: true },
);

export const GenerationJob: Model<IGenerationJob> =
  (mongoose.models.GenerationJob as Model<IGenerationJob> | undefined) ??
  model<IGenerationJob>('GenerationJob', generationJobSchema);
