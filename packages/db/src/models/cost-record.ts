// Défaut + destructuration : l'export nommé `models` de mongoose (CJS) n'est
// pas détecté par le lexer de Node ESM (worker exécuté via tsx).
import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';

// Enregistrement d'un coût de génération (Prompt 55). Une ligne = un appel
// facturable (Claude, TTS, rendu vidéo, image). Alimenté par recordCost côté
// worker ; agrégé par le dashboard admin pour le coût par cours et la marge
// par plan. Les métriques brutes (tokens/caractères/secondes) sont conservées
// en plus de l'estimation USD, pour re-calculer si la grille de tarifs change.

/** Nature du coût — aligné sur CostKind (@sallycourse/shared/pricing-table). */
export const COST_KINDS = ['claude', 'tts', 'render', 'image'] as const;
export type CostKind = (typeof COST_KINDS)[number];

export interface ICostRecord {
  courseId: Types.ObjectId;
  /** Propriétaire du cours (dénormalisé pour agréger par plan sans jointure). */
  userId: Types.ObjectId;
  kind: CostKind;
  /** Tokens d'entrée (kind=claude). */
  tokensIn?: number;
  /** Tokens de sortie (kind=claude). */
  tokensOut?: number;
  /** Caractères synthétisés (kind=tts). */
  chars?: number;
  /** Secondes produites (kind=render). */
  seconds?: number;
  /** Modèle/provider facturé (ex. claude-sonnet-5, elevenlabs) — traçabilité. */
  model?: string;
  /** Coût estimé en USD (issu de pricing-table). */
  estimatedUsd: number;
  createdAt: Date;
}

export type CostRecordDocument = HydratedDocument<ICostRecord>;

const costRecordSchema = new Schema<ICostRecord>(
  {
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: [...COST_KINDS], required: true },
    tokensIn: { type: Number, min: 0 },
    tokensOut: { type: Number, min: 0 },
    chars: { type: Number, min: 0 },
    seconds: { type: Number, min: 0 },
    model: { type: String },
    estimatedUsd: { type: Number, required: true, min: 0 },
  },
  // createdAt seul : un enregistrement de coût est immuable (pas d'updatedAt).
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Agrégation « coût par cours » : tri chronologique par cours.
costRecordSchema.index({ courseId: 1, createdAt: -1 });

export const CostRecord: Model<ICostRecord> =
  (mongoose.models.CostRecord as Model<ICostRecord> | undefined) ??
  model<ICostRecord>('CostRecord', costRecordSchema);
