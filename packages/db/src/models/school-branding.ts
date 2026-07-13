// Défaut + destructuration : l'export nommé `models` de mongoose (CJS) n'est
// pas détecté par le lexer de Node ESM (worker exécuté via tsx).
import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';

// Marque blanche (white-label) du certificat — plan Business (Prompt 88).
// Un document par utilisateur : logo + couleurs de l'école remplacent la
// marque SALISTAR par défaut sur le certificat PDF, UNIQUEMENT si l'utilisateur
// est plan business ET a configuré son branding (cf. resolveCertificateBranding
// côté apps/web/src/lib/lms.ts). Les couleurs sont validées comme hex ici
// (garde-fou schéma) ET revalidées côté zod (packages/shared) pour les API.

/** Couleur hexadécimale stricte (#RGB ou #RRGGBB), insensible à la casse. */
const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export interface ISchoolBranding {
  userId: Types.ObjectId;
  /** Nom de l'école affiché à la place de « Salistar » sur le certificat. */
  schoolName: string;
  /**
   * Clé de stockage S3/MinIO du logo (ex. "branding/{userId}/logo.png"), PAS
   * une URL publique — le bucket n'est pas exposé publiquement. L'URL de
   * lecture est régénérée à la demande (presignedGetUrl) par la route
   * settings/branding et par le rendu du certificat. Nommé `logoUrl` pour
   * matcher le contrat API/prompt ; contient en réalité la storageKey.
   */
  logoUrl?: string;
  /** Couleur principale (remplace le violet de marque) — hex #RRGGBB. */
  primaryColorHex: string;
  /** Couleur d'accent (remplace l'or de marque) — hex #RRGGBB. */
  accentColorHex: string;
  /**
   * Sous-domaine white-label (Prompt 143, plan Business) — ex. "academie-client"
   * pour https://academie-client.sallycourse.com/. Résolu par le middleware
   * (apps/web/src/middleware.ts) pour router vers /school/[subdomain], filtré
   * par le userId propriétaire de ce document. Absent = pas de sous-domaine
   * configuré (le certificat peut rester en marque blanche sans catalogue public).
   */
  customSubdomain?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type SchoolBrandingDocument = HydratedDocument<ISchoolBranding>;

const schoolBrandingSchema = new Schema<ISchoolBranding>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    schoolName: { type: String, required: true, trim: true, maxlength: 80 },
    logoUrl: { type: String, trim: true },
    primaryColorHex: {
      type: String,
      required: true,
      trim: true,
      default: '#8E55BE', // violet-500 (défaut de marque — voir tokens.ts)
      validate: {
        validator: (v: string) => HEX_COLOR_RE.test(v),
        message: (props: { value: string }) => `« ${props.value} » n'est pas une couleur hexadécimale valide.`,
      },
    },
    accentColorHex: {
      type: String,
      required: true,
      trim: true,
      default: '#D4A017', // gold-500 (défaut de marque — voir tokens.ts)
      validate: {
        validator: (v: string) => HEX_COLOR_RE.test(v),
        message: (props: { value: string }) => `« ${props.value} » n'est pas une couleur hexadécimale valide.`,
      },
    },
    // Additif (P143) : unique + sparse (plusieurs documents sans sous-domaine
    // ne doivent PAS entrer en conflit d'unicité — sparse ignore les valeurs
    // absentes de l'index).
    customSubdomain: {
      type: String,
      trim: true,
      lowercase: true,
      unique: true,
      sparse: true,
    },
  },
  { timestamps: true },
);

// Pattern hot-reload safe (Next) : réutilise le modèle déjà compilé.
export const SchoolBranding: Model<ISchoolBranding> =
  (mongoose.models.SchoolBranding as Model<ISchoolBranding> | undefined) ??
  model<ISchoolBranding>('SchoolBranding', schoolBrandingSchema);
