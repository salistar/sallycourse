import {
  Schema,
  model,
  models,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';

// Lien d'affiliation (Prompt 89) : chaque utilisateur dispose d'un code unique
// à partager (/r/<code>). Le clic pose un cookie de tracking 30 jours ; si le
// visiteur souscrit un abonnement payant avant expiration du cookie, le webhook
// d'activation (P54, voir lib/payments/plans.ts) crédite une commission en
// attente (pendingCommissionsUsd). Le versement effectif reste manuel (hors
// scope) — ce modèle ne fait que suivre clics/conversions/gains.

export interface IAffiliateLink {
  userId: Types.ObjectId;
  /** Code court unique inséré dans l'URL de partage (/r/<code>). */
  code: string;
  /** Nombre de clics bruts sur le lien (avant déduplication éventuelle). */
  clicks: number;
  /** Nombre d'abonnements payants activés attribués à ce lien. */
  conversions: number;
  /** Taux de commission appliqué (0.2 = 20 % du montant du premier paiement). */
  commissionRate: number;
  /** Commissions cumulées en attente de versement, en USD. */
  pendingCommissionsUsd: number;
  /** Commissions déjà versées (suivi manuel), en USD. */
  paidCommissionsUsd: number;
  createdAt: Date;
  updatedAt: Date;
}

export type AffiliateLinkDocument = HydratedDocument<IAffiliateLink>;

const affiliateLinkSchema = new Schema<IAffiliateLink>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    code: { type: String, required: true, unique: true, trim: true },
    clicks: { type: Number, default: 0, min: 0 },
    conversions: { type: Number, default: 0, min: 0 },
    commissionRate: { type: Number, default: 0.2, min: 0, max: 1 },
    pendingCommissionsUsd: { type: Number, default: 0, min: 0 },
    paidCommissionsUsd: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

// Un utilisateur peut avoir plusieurs codes historiques, mais on liste par récence.
affiliateLinkSchema.index({ userId: 1, createdAt: -1 });

export const AffiliateLink: Model<IAffiliateLink> =
  (models.AffiliateLink as Model<IAffiliateLink> | undefined) ??
  model<IAffiliateLink>('AffiliateLink', affiliateLinkSchema);
