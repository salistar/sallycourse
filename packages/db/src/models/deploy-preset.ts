// Défaut + destructuration : l'export nommé `models` de mongoose (CJS) n'est
// pas détecté par le lexer de Node ESM (worker exécuté via tsx).
import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';

// Marketplace de préconfiguration de déploiement (Prompt 109) : un preset
// mémorise UN jeu de plateformes/mode/compte réutilisable en un clic sur
// n'importe quel autre cours de l'utilisateur. `isPublic` permet le partage
// (lecture seule) avec les autres utilisateurs — jamais les credentials en
// clair, seulement les références (accountLabel, pas le secret).

/** Une entrée de plateforme dans un preset : mode + compte (par libellé). */
export interface IDeployPresetPlatform {
  platform: string;
  mode: 'auto' | 'assisted' | 'manual';
  /**
   * Libellé du compte PlatformCredential visé (pas l'ObjectId : un preset
   * partagé publiquement ne doit jamais référencer un credential d'autrui).
   * Résolu à l'application par (userId courant, platform, accountLabel).
   * Absent → le worker retient le compte le plus récent pour la plateforme.
   */
  accountLabel?: string;
}

/** Tarification informative du preset (optionnelle, affichage seul). */
export interface IDeployPresetPricing {
  currency?: string;
  amount?: number;
  note?: string;
}

export interface IDeployPreset {
  userId: Types.ObjectId;
  name: string;
  platforms: IDeployPresetPlatform[];
  pricing?: IDeployPresetPricing;
  /** Références de templates réutilisables (landing, description…), libre. */
  templateRefs?: string[];
  /** Partage en lecture seule avec les autres utilisateurs (marketplace). */
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type DeployPresetDocument = HydratedDocument<IDeployPreset>;

const deployPresetPlatformSchema = new Schema<IDeployPresetPlatform>(
  {
    platform: { type: String, required: true, trim: true },
    mode: { type: String, enum: ['auto', 'assisted', 'manual'], default: 'auto' },
    accountLabel: { type: String, trim: true },
  },
  { _id: false },
);

const deployPresetSchema = new Schema<IDeployPreset>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    platforms: { type: [deployPresetPlatformSchema], default: [] },
    pricing: {
      type: new Schema<IDeployPresetPricing>(
        {
          currency: { type: String, trim: true },
          amount: { type: Number, min: 0 },
          note: { type: String, trim: true, maxlength: 280 },
        },
        { _id: false },
      ),
      required: false,
    },
    templateRefs: { type: [String], default: [] },
    isPublic: { type: Boolean, default: false },
  },
  { timestamps: true },
);

deployPresetSchema.index({ userId: 1, updatedAt: -1 });
// Découverte des presets publics (marketplace) triés par récence.
deployPresetSchema.index({ isPublic: 1, updatedAt: -1 });

export const DeployPreset: Model<IDeployPreset> =
  (mongoose.models.DeployPreset as Model<IDeployPreset> | undefined) ??
  model<IDeployPreset>('DeployPreset', deployPresetSchema);
