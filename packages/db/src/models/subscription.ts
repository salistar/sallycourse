// Défaut + destructuration : l'export nommé `models` de mongoose (CJS) n'est
// pas détecté par le lexer de Node ESM (worker exécuté via tsx).
import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';
// prettier-ignore
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext) ; typage intact ici (Bundler)
import { PLANS, type PlanId } from '@sallycourse/shared';

// Identifiants de plan dérivés de la constante partagée (free|pro|business).
const PLAN_IDS = Object.keys(PLANS) as PlanId[];

/** Prestataire de paiement à l'origine de l'abonnement. */
export const PAYMENT_PROVIDERS = ['cmi', 'paddle', 'lemonsqueezy', 'mock'] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

/** État courant de l'abonnement. */
export const SUBSCRIPTION_STATUSES = ['active', 'past_due', 'canceled', 'expired'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export interface ISubscription {
  userId: Types.ObjectId;
  plan: PlanId;
  provider: PaymentProvider;
  status: SubscriptionStatus;
  /** Fin de la période payée en cours (renouvellement/expiration). */
  currentPeriodEnd?: Date;
  /**
   * Référence opaque côté prestataire : oid CMI, subscription_id Paddle,
   * id Lemon Squeezy… Sert à rapprocher les webhooks de l'abonnement.
   */
  providerRef?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type SubscriptionDocument = HydratedDocument<ISubscription>;

const subscriptionSchema = new Schema<ISubscription>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    plan: { type: String, enum: PLAN_IDS, required: true },
    provider: { type: String, enum: [...PAYMENT_PROVIDERS], required: true },
    status: { type: String, enum: [...SUBSCRIPTION_STATUSES], default: 'active' },
    currentPeriodEnd: { type: Date },
    providerRef: { type: String, trim: true },
  },
  { timestamps: true },
);

// Rapprochement des webhooks : recherche par (provider, providerRef).
subscriptionSchema.index({ provider: 1, providerRef: 1 });
subscriptionSchema.index({ userId: 1 });

// Pattern hot-reload safe (Next) : réutilise le modèle déjà compilé.
export const Subscription: Model<ISubscription> =
  (mongoose.models.Subscription as Model<ISubscription> | undefined) ??
  model<ISubscription>('Subscription', subscriptionSchema);
