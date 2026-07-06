import {
  Schema,
  model,
  models,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';
import { logEntrySchema, type LogEntry } from './common';

export const DEPLOYMENT_STATUSES = [
  'pending',
  'running',
  'paused',
  'failed',
  'published',
] as const;
export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

export const DEPLOYMENT_MODES = ['auto', 'assisted', 'manual'] as const;
export type DeploymentMode = (typeof DEPLOYMENT_MODES)[number];

export interface IDeployment {
  courseId: Types.ObjectId;
  userId: Types.ObjectId;
  /** Plateforme cible (udemy, youtube…). */
  platform: string;
  status: DeploymentStatus;
  mode: DeploymentMode;
  externalUrl?: string;
  /** Point de reprise pour les déploiements pausés/interrompus. */
  checkpoint: {
    lessonIndex: number;
    step: string;
  };
  logs: LogEntry[];
  createdAt: Date;
  updatedAt: Date;
}

export type DeploymentDocument = HydratedDocument<IDeployment>;

const deploymentSchema = new Schema<IDeployment>(
  {
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    platform: { type: String, required: true, trim: true },
    status: { type: String, enum: [...DEPLOYMENT_STATUSES], default: 'pending' },
    mode: { type: String, enum: [...DEPLOYMENT_MODES], default: 'auto' },
    externalUrl: { type: String },
    checkpoint: {
      lessonIndex: { type: Number, default: 0, min: 0 },
      step: { type: String, default: '' },
    },
    logs: { type: [logEntrySchema], default: [] },
  },
  { timestamps: true },
);

deploymentSchema.index({ courseId: 1, platform: 1 });

export const Deployment: Model<IDeployment> =
  (models.Deployment as Model<IDeployment> | undefined) ??
  model<IDeployment>('Deployment', deploymentSchema);
