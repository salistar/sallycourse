// Déploiements programmés — « drip » (Prompt 181). Modèle ADDITIF : un plan de
// publication ÉTALÉE par cours, une entrée par plateforme cible avec sa cadence
// et son état runtime (cursor = éléments déjà publiés, nextRunAt = échéance).
// N'affecte aucune collection existante ; la logique de décision vit dans la
// fonction PURE @sallycourse/shared/deploy-schedule (planEntryRun & co).
//
// Défaut + destructuration : l'export nommé `models` de mongoose (CJS) n'est pas
// détecté par le lexer de Node ESM (worker exécuté via tsx).
import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';

export const DEPLOYMENT_SCHEDULE_STATUSES = ['active', 'paused', 'completed'] as const;
export type DeploymentScheduleStatus = (typeof DEPLOYMENT_SCHEDULE_STATUSES)[number];

/** Natures de cadence (miroir de DRIP_CADENCE_KINDS côté shared). */
export const DRIP_CADENCE_KINDS = ['immediate', 'per-week', 'per-day'] as const;
export type DripCadenceKind = (typeof DRIP_CADENCE_KINDS)[number];

/**
 * Cadence persistée d'une entrée. Sous-document souple : `count` (per-week/
 * per-day) et `days` (per-day) sont optionnels selon `kind`. La validation
 * stricte est faite en amont par le schéma zod shared à la création du plan.
 */
export interface IDripCadence {
  kind: DripCadenceKind;
  count?: number;
  days?: number;
}

/** Une entrée du plan : une plateforme, sa cadence et son état runtime. */
export interface IDeploymentScheduleEntry {
  platform: string;
  cadence: IDripCadence;
  /** Éléments déjà publiés pour cette plateforme (avance à chaque passage). */
  cursor: number;
  /** Prochaine échéance de passage (absente = dû au prochain cron). */
  nextRunAt?: Date;
}

export interface IDeploymentSchedule {
  courseId: Types.ObjectId;
  userId: Types.ObjectId;
  entries: IDeploymentScheduleEntry[];
  status: DeploymentScheduleStatus;
  createdAt: Date;
  updatedAt: Date;
}

export type DeploymentScheduleDocument = HydratedDocument<IDeploymentSchedule>;

const dripCadenceSchema = new Schema<IDripCadence>(
  {
    kind: { type: String, enum: [...DRIP_CADENCE_KINDS], required: true },
    count: { type: Number, min: 1 },
    days: { type: Number, min: 1 },
  },
  { _id: false },
);

const deploymentScheduleEntrySchema = new Schema<IDeploymentScheduleEntry>(
  {
    platform: { type: String, required: true, trim: true },
    cadence: { type: dripCadenceSchema, required: true },
    cursor: { type: Number, default: 0, min: 0 },
    nextRunAt: { type: Date },
  },
  { _id: false },
);

const deploymentScheduleSchema = new Schema<IDeploymentSchedule>(
  {
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    entries: { type: [deploymentScheduleEntrySchema], default: [] },
    status: { type: String, enum: [...DEPLOYMENT_SCHEDULE_STATUSES], default: 'active' },
  },
  { timestamps: true },
);

// Un plan drip par cours (re-création = remplacement via upsert).
deploymentScheduleSchema.index({ courseId: 1 }, { unique: true });
// Sélection efficace des plans dus par le cron (actifs avec une échéance passée).
deploymentScheduleSchema.index({ status: 1, 'entries.nextRunAt': 1 });

export const DeploymentSchedule: Model<IDeploymentSchedule> =
  (mongoose.models.DeploymentSchedule as Model<IDeploymentSchedule> | undefined) ??
  model<IDeploymentSchedule>('DeploymentSchedule', deploymentScheduleSchema);
