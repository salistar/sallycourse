import {
  Schema,
  model,
  models,
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
  },
  { timestamps: true },
);

// Pattern hot-reload safe (Next) : réutilise le modèle déjà compilé.
export const SchoolBranding: Model<ISchoolBranding> =
  (models.SchoolBranding as Model<ISchoolBranding> | undefined) ??
  model<ISchoolBranding>('SchoolBranding', schoolBrandingSchema);
