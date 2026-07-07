import {
  Schema,
  model,
  models,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';

// Clé API par utilisateur pour l'API publique v1 (Prompt 51).
// On ne stocke JAMAIS la clé en clair : seul son hash SHA-256 (hashedKey) est
// persisté, plus un préfixe court (prefix) pour l'afficher dans l'UI et pour
// une pré-sélection rapide au moment de la vérification. La clé complète en
// clair n'est renvoyée qu'UNE fois, à la création.

export interface IApiKey {
  userId: Types.ObjectId;
  /** Hash SHA-256 (hex) de la clé complète — jamais la clé en clair. */
  hashedKey: string;
  /** Préfixe public (ex. "sk_live_ab12cd34") affiché dans l'UI. */
  prefix: string;
  /** Libellé choisi par l'utilisateur (ex. « CI GitHub »). */
  label: string;
  /** Dernière utilisation datée, pour repérer les clés dormantes. */
  lastUsed?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type ApiKeyDocument = HydratedDocument<IApiKey>;

const apiKeySchema = new Schema<IApiKey>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    hashedKey: { type: String, required: true, unique: true },
    prefix: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    lastUsed: { type: Date },
  },
  { timestamps: true },
);

apiKeySchema.index({ userId: 1, createdAt: -1 });

// Pattern hot-reload safe (Next) : réutilise le modèle déjà compilé.
export const ApiKey: Model<IApiKey> =
  (models.ApiKey as Model<IApiKey> | undefined) ??
  model<IApiKey>('ApiKey', apiKeySchema);
