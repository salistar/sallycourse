// Défaut + destructuration : l'export nommé `models` de mongoose (CJS) n'est
// pas détecté par le lexer de Node ESM (worker exécuté via tsx).
import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';

// Abonnement Web Push natif (Prompt 156) — un document par navigateur/appareil
// abonné (PushManager.subscribe() côté client). Les clés `p256dh`/`auth` sont
// celles renvoyées par le navigateur (PushSubscriptionJSON.keys) : nécessaires
// pour chiffrer la charge utile envoyée à l'endpoint FCM/Mozilla (voir
// apps/web/src/lib/web-push.ts). `endpoint` est unique par abonnement — un
// même utilisateur peut avoir plusieurs abonnements (plusieurs appareils).

export interface IPushSubscription {
  userId: Types.ObjectId;
  /** URL du push service du navigateur (FCM pour Chrome/Edge, Mozilla autopush pour Firefox…). */
  endpoint: string;
  /** Clé publique ECDH du client (base64url) — chiffrement de la charge utile. */
  p256dh: string;
  /** Secret d'authentification du client (base64url). */
  auth: string;
  /** User-Agent au moment de l'abonnement — utile pour le diagnostic UI. */
  userAgent?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type PushSubscriptionDocument = HydratedDocument<IPushSubscription>;

const pushSubscriptionSchema = new Schema<IPushSubscription>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true, unique: true, trim: true },
    p256dh: { type: String, required: true, trim: true },
    auth: { type: String, required: true, trim: true },
    userAgent: { type: String, maxlength: 300 },
  },
  { timestamps: true },
);

pushSubscriptionSchema.index({ userId: 1, createdAt: -1 });

// Pattern hot-reload safe (Next) : réutilise le modèle déjà compilé.
export const PushSubscription: Model<IPushSubscription> =
  (mongoose.models.PushSubscription as Model<IPushSubscription> | undefined) ??
  model<IPushSubscription>('PushSubscription', pushSubscriptionSchema);
