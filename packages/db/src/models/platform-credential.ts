// Défaut + destructuration : l'export nommé `models` de mongoose (CJS) n'est
// pas détecté par le lexer de Node ESM (worker exécuté via tsx).
import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';

// Credentials d'une plateforme de déploiement (Udemy, YouTube, Teachable…).
// Le secret (mot de passe, clé API, jeton OAuth) est stocké CHIFFRÉ en base
// via encryptSecret (AES-256-GCM) — jamais en clair. Le déchiffrement se fait
// à l'usage côté serveur/worker avec CREDENTIALS_MASTER_KEY.
//
// Multi-comptes (Prompt 49) : un utilisateur peut connecter PLUSIEURS comptes
// par plateforme (ex. Udemy FR + Udemy EN), distingués par accountLabel. La
// clé d'unicité est donc { userId, platform, accountLabel } : ré-ajouter le
// même libellé écrase (upsert), un libellé différent crée un nouveau compte.

/** Nature du secret stocké — pilote le formulaire d'ajout côté UI. */
export const CREDENTIAL_KINDS = ['password', 'apikey', 'oauth'] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

/** Plateformes de déploiement supportées. */
export const CREDENTIAL_PLATFORMS = [
  'udemy',
  'youtube',
  'teachable',
  'thinkific',
  'podia',
  'gumroad',
  'skillshare',
  'moodle',
  'internal',
  // Repurposing courts (Prompt 106) — comptes de publication programmée.
  'tiktok',
  'instagram',
] as const;
export type CredentialPlatform = (typeof CREDENTIAL_PLATFORMS)[number];

export interface IPlatformCredential {
  userId: Types.ObjectId;
  platform: string;
  /** Libellé affiché (email du compte, nom du projet…). */
  accountLabel: string;
  kind: CredentialKind;
  /** Blob chiffré "v1:iv:tag:data" — encryptSecret d'un JSON sérialisé. JAMAIS en clair. */
  data: string;
  createdAt: Date;
  updatedAt: Date;
}

export type PlatformCredentialDocument = HydratedDocument<IPlatformCredential>;

const platformCredentialSchema = new Schema<IPlatformCredential>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    platform: { type: String, required: true, trim: true },
    accountLabel: { type: String, required: true, trim: true },
    kind: { type: String, enum: [...CREDENTIAL_KINDS], required: true },
    data: { type: String, required: true },
  },
  { timestamps: true },
);

// Un compte par (utilisateur, plateforme, libellé) : ré-ajouter le même libellé
// écrase (upsert), un libellé différent crée un compte supplémentaire.
platformCredentialSchema.index(
  { userId: 1, platform: 1, accountLabel: 1 },
  { unique: true },
);

// Pattern hot-reload safe (Next) : réutilise le modèle déjà compilé.
export const PlatformCredential: Model<IPlatformCredential> =
  (mongoose.models.PlatformCredential as Model<IPlatformCredential> | undefined) ??
  model<IPlatformCredential>('PlatformCredential', platformCredentialSchema);
