// Défaut + destructuration : l'export nommé `models` de mongoose (CJS) n'est
// pas détecté par le lexer de Node ESM (worker exécuté via tsx).
import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';
// @ts-ignore TS6059 — consommé en source par le worker (rootDir=src) ; typage intact
import { logEntrySchema, type LogEntry } from './common.js';

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

/**
 * Instantané d'une leçon telle que DÉPLOYÉE (P46) : sert de référence au diff
 * de mise à jour ciblée (contentHash courant vs déployé). `version` s'incrémente
 * à chaque (re)déploiement de la leçon.
 */
export interface IDeployedLesson {
  lessonId: Types.ObjectId;
  contentHash: string;
  version: number;
  deployedAt: Date;
}

export interface IDeployment {
  courseId: Types.ObjectId;
  userId: Types.ObjectId;
  /** Plateforme cible (udemy, youtube…). */
  platform: string;
  status: DeploymentStatus;
  mode: DeploymentMode;
  /**
   * Compte plateforme (PlatformCredential) utilisé — multi-comptes (P49).
   * Mémorisé pour que les relances (retry) réutilisent le même compte.
   */
  credentialId?: Types.ObjectId;
  externalUrl?: string;
  /** Identifiant du cours côté plateforme (renseigné par createCourse). */
  externalId?: string;
  /** Point de reprise pour les déploiements pausés/interrompus. */
  checkpoint: {
    lessonIndex: number;
    step: string;
  };
  /** Instantané des leçons déployées — base du diff de mise à jour (P46). */
  deployedVersions: IDeployedLesson[];
  /**
   * Checklist de publication MANUELLE (P178) : en mode `manual`, l'auteur coche
   * chaque étape franchie sur la plateforme puis colle l'URL finale. Vide ([])
   * pour les modes auto/assisté. Additif — aucun impact sur les déploiements
   * existants.
   */
  checklist: { key: string; label: string; done: boolean }[];
  /** Horodatage du basculement en `published` par publication manuelle (P178). */
  publishedManuallyAt?: Date;
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
    credentialId: { type: Schema.Types.ObjectId, ref: 'PlatformCredential' },
    externalUrl: { type: String },
    externalId: { type: String },
    checkpoint: {
      lessonIndex: { type: Number, default: 0, min: 0 },
      step: { type: String, default: '' },
    },
    deployedVersions: {
      type: [
        new Schema<IDeployedLesson>(
          {
            lessonId: { type: Schema.Types.ObjectId, ref: 'Lesson', required: true },
            contentHash: { type: String, required: true },
            version: { type: Number, default: 1, min: 1 },
            deployedAt: { type: Date, default: Date.now },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    checklist: {
      type: [
        new Schema<{ key: string; label: string; done: boolean }>(
          {
            key: { type: String, required: true },
            label: { type: String, required: true },
            done: { type: Boolean, default: false },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    publishedManuallyAt: { type: Date },
    logs: { type: [logEntrySchema], default: [] },
  },
  { timestamps: true },
);

deploymentSchema.index({ courseId: 1, platform: 1 });

export const Deployment: Model<IDeployment> =
  (mongoose.models.Deployment as Model<IDeployment> | undefined) ??
  model<IDeployment>('Deployment', deploymentSchema);
