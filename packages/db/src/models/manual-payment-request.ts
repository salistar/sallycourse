import {
  Schema,
  model,
  models,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';
// prettier-ignore
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext) ; typage intact ici (Bundler)
import { type PlanId } from '@sallycourse/shared';

/**
 * Demande de paiement manuel (Prompt 158) : option « virement/paiement
 * manuel avec validation admin » pour l'international, à zéro commission —
 * alternative à Paddle quand l'utilisateur préfère un virement bancaire
 * direct. Flux : l'utilisateur soumet la demande (+ preuve de virement
 * optionnelle) → un admin approuve (active le plan, comme le ferait le
 * webhook CMI/Paddle) ou rejette. Aucun rapprochement automatique : la
 * validation est humaine par construction (pas de webhook prestataire).
 */

/** Devise déclarée par l'utilisateur pour son virement (large — hors CMI/Paddle). */
export const MANUAL_PAYMENT_CURRENCIES = ['EUR', 'USD', 'MAD', 'GBP'] as const;
export type ManualPaymentCurrency = (typeof MANUAL_PAYMENT_CURRENCIES)[number];

/** Statut du cycle de vie de la demande. */
export const MANUAL_PAYMENT_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ManualPaymentStatus = (typeof MANUAL_PAYMENT_STATUSES)[number];

export interface IManualPaymentRequest {
  userId: Types.ObjectId;
  plan: PlanId;
  /** Montant déclaré par l'utilisateur (plus petite unité — centimes). */
  amountRequested: number;
  currency: ManualPaymentCurrency;
  /** Clé de stockage objet de la preuve de virement (optionnelle à la soumission). */
  proofUrl?: string;
  status: ManualPaymentStatus;
  /** Admin ayant traité la demande (approuvé ou rejeté) — absent tant que pending. */
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;
  /** Motif de rejet, saisi par l'admin (optionnel). */
  rejectionReason?: string;
  /** Note libre de l'utilisateur à la soumission (référence de virement, banque…). */
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type ManualPaymentRequestDocument = HydratedDocument<IManualPaymentRequest>;

const manualPaymentRequestSchema = new Schema<IManualPaymentRequest>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    plan: { type: String, required: true },
    amountRequested: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: [...MANUAL_PAYMENT_CURRENCIES], required: true },
    proofUrl: { type: String },
    status: { type: String, enum: [...MANUAL_PAYMENT_STATUSES], default: 'pending', index: true },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    rejectionReason: { type: String, trim: true },
    note: { type: String, trim: true },
  },
  { timestamps: true },
);

// File d'attente admin : les plus récentes d'abord, filtrable par statut.
manualPaymentRequestSchema.index({ status: 1, createdAt: -1 });
manualPaymentRequestSchema.index({ userId: 1, createdAt: -1 });

// Pattern hot-reload safe (Next) : réutilise le modèle déjà compilé.
export const ManualPaymentRequest: Model<IManualPaymentRequest> =
  (models.ManualPaymentRequest as Model<IManualPaymentRequest> | undefined) ??
  model<IManualPaymentRequest>('ManualPaymentRequest', manualPaymentRequestSchema);
