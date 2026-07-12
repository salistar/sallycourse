import {
  Schema,
  model,
  models,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';

// Client d'agence (Prompt 150, mode agence) : une agence (User.isAgency=true)
// gère plusieurs clients pour lesquels elle génère et déploie des cours EN
// LEUR NOM. Ce document ne référence QUE les identifiants des
// PlatformCredential appartenant au client — jamais ceux de l'agence — afin
// qu'un déploiement fait « pour ce client » utilise systématiquement les
// comptes de publication du client (isolation stricte, cf.
// resolveAgencyDeployCredentials côté @sallycourse/shared/agency).
//
// Le client n'a pas de compte User propre : c'est un profil administré par
// l'agence (nom + email de contact), pas un utilisateur connecté.

export interface IAgencyClient {
  /** Agence propriétaire (User.isAgency=true) — jamais le client lui-même. */
  agencyUserId: Types.ObjectId;
  clientName: string;
  clientEmail: string;
  /**
   * PlatformCredential DU CLIENT (pas de l'agence) utilisés pour les
   * déploiements réalisés en son nom. Référence uniquement — le document
   * PlatformCredential garde son propre userId (celui du client, si le client
   * a un compte, ou un compte technique dédié créé par l'agence pour lui).
   */
  platformCredentials: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

export type AgencyClientDocument = HydratedDocument<IAgencyClient>;

const agencyClientSchema = new Schema<IAgencyClient>(
  {
    agencyUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    clientName: { type: String, required: true, trim: true, maxlength: 120 },
    clientEmail: { type: String, required: true, trim: true, lowercase: true },
    platformCredentials: {
      type: [{ type: Schema.Types.ObjectId, ref: 'PlatformCredential' }],
      default: [],
    },
  },
  { timestamps: true },
);

// Listing des clients d'une agence, du plus récent au plus ancien.
agencyClientSchema.index({ agencyUserId: 1, createdAt: -1 });

// Pattern hot-reload safe (Next) : réutilise le modèle déjà compilé.
export const AgencyClient: Model<IAgencyClient> =
  (models.AgencyClient as Model<IAgencyClient> | undefined) ??
  model<IAgencyClient>('AgencyClient', agencyClientSchema);
