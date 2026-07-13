// Défaut + destructuration : l'export nommé `models` de mongoose (CJS) n'est
// pas détecté par le lexer de Node ESM (worker exécuté via tsx).
import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';

// Webhook sortant par utilisateur (Prompt 51). À chaque transition d'un cours
// (outline prête, génération terminée, déployé, review approuvée) on notifie
// les URLs abonnées avec une signature HMAC-SHA256 (en-tête X-SallyCourse-Signature)
// dérivée du `secret` propre à chaque webhook, permettant au récepteur de
// vérifier l'authenticité du payload.

/** Événements émettables — source de vérité partagée avec deploy/webhooks.ts. */
export const WEBHOOK_EVENTS = [
  'outline_ready',
  'generation_complete',
  'deployed',
  'review_approved',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface IWebhook {
  userId: Types.ObjectId;
  /** URL de destination (https attendu en production). */
  url: string;
  /** Événements auxquels ce webhook est abonné. */
  events: WebhookEvent[];
  /** Secret de signature HMAC — généré serveur, propre à ce webhook. */
  secret: string;
  /** Actif : un webhook désactivé n'est plus notifié (sans le supprimer). */
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type WebhookDocument = HydratedDocument<IWebhook>;

const webhookSchema = new Schema<IWebhook>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    url: { type: String, required: true, trim: true },
    events: {
      type: [{ type: String, enum: [...WEBHOOK_EVENTS] }],
      default: [...WEBHOOK_EVENTS],
    },
    secret: { type: String, required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

webhookSchema.index({ userId: 1, createdAt: -1 });

// Pattern hot-reload safe (Next) : réutilise le modèle déjà compilé.
export const Webhook: Model<IWebhook> =
  (mongoose.models.Webhook as Model<IWebhook> | undefined) ??
  model<IWebhook>('Webhook', webhookSchema);
