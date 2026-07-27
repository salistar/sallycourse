// Défaut + destructuration : l'export nommé `models` de mongoose (CJS) n'est
// pas détecté par le lexer de Node ESM (worker exécuté via tsx).
import mongoose, { Schema, model, type HydratedDocument, type Model } from 'mongoose';
// prettier-ignore
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext) ; typage intact ici (Bundler)
import { LOCALES, PLANS, type Locale, type PlanId } from '@sallycourse/shared';

// Identifiants de plan dérivés de la constante partagée (free|pro|business).
const PLAN_IDS = Object.keys(PLANS) as PlanId[];

export interface IUser {
  email: string;
  passwordHash: string;
  name: string;
  plan: PlanId;
  quotaUsed: {
    coursesThisMonth: number;
    periodStart: Date;
  };
  locale: Locale;
  role: 'user' | 'admin';
  /** Compte banni par un admin (P57) — bloque l'usage sans supprimer les données. */
  banned: boolean;
  /**
   * Voix clonée (P81, ElevenLabs Voice Cloning) — champs additifs. voiceId
   * ElevenLabs (ou fictif déterministe en mock) réutilisable comme Course.ttsVoice.
   */
  clonedVoiceId?: string;
  /** Statut du clonage : aucune demande / en cours / prête / échouée. */
  voiceCloneStatus?: 'none' | 'pending' | 'ready' | 'failed';
  /** Consentement explicite requis avant tout clonage (case cochée côté UI). */
  voiceCloneConsent?: boolean;
  /** Durée (s) de l'échantillon audio ayant servi au clonage — traçabilité. */
  voiceCloneSampleSeconds?: number;
  /**
   * Horodatage du dernier upload d'un échantillon vocal (stocké à
   * storageKeys.voiceSample(userId)) pour le clonage Chatterbox/Modal. Sert de
   * drapeau de présence ET de version (entre dans la clé de cache TTS : une
   * ré-écoute avec un nouvel échantillon invalide l'ancien audio). Additif.
   */
  voiceSampleUploadedAt?: Date;
  /**
   * Code d'affiliation référent en attente (Prompt 89) : capturé depuis le
   * cookie de tracking (sc_ref) au moment où l'utilisateur initie un paiement
   * (checkout CMI, activation mock). `activatePlan` le consomme pour créditer
   * une commission au référent puis le vide — jamais utilisé après la
   * première conversion. Additif, absent par défaut.
   */
  pendingReferralCode?: string | null;
  /**
   * Préférence d'accessibilité (Prompt 137) : si activée, augmente légèrement
   * la taille de police dans les gabarits de slides au rendu vidéo (paramètre
   * `largeText` optionnel de renderTemplate — @sallycourse/design). Additif,
   * défaut false : aucun changement pour les utilisateurs existants.
   */
  preferLargeText?: boolean;
  /**
   * Réglages de facturation Maroc (Prompt 148, conformité fiscale) — renseignés
   * dans settings/billing, repris tels quels (snapshot) sur chaque Invoice émise.
   * Tous optionnels : un utilisateur hors Maroc ou n'ayant pas encore complété
   * ses réglages continue de payer normalement (facture sans ICE/IF).
   */
  billingTaxStatus?: 'auto_entrepreneur' | 'company' | 'unspecified';
  /** Identifiant Commun de l'Entreprise — obligatoire côté société marocaine. */
  billingIce?: string;
  /** Identifiant Fiscal — obligatoire côté société marocaine. */
  billingIf?: string;
  /** Raison sociale / nom facturé (défaut : User.name si vide). */
  billingCompanyName?: string;
  /** Adresse de facturation (ligne libre, affichée sur la facture). */
  billingAddress?: string;
  /**
   * Profil agence (Prompt 150, mode agence) : true si ce compte génère et
   * déploie des cours au nom de clients tiers (voir AgencyClient,
   * Course.agencyClientId). Additif, défaut false — aucun changement pour
   * les utilisateurs existants.
   */
  isAgency?: boolean;
  /**
   * Avatar « talking-head » (Ditto/Modal) : horodatage du dernier upload d'une
   * photo de visage du présentateur (stockée à storageKeys.avatarFace(userId)).
   * Sert de drapeau de présence — un cours avec avatarEnabled n'active l'avatar
   * réel que si cette photo existe. Additif, absent par défaut.
   */
  avatarFaceUploadedAt?: Date;
  /**
   * Page instructeur publique (Prompt 205) — handle unique SANS le « @ »
   * (format @sallycourse/shared HANDLE_PATTERN : [a-z0-9_-]{3,30}). Tant qu'il
   * est absent, l'utilisateur n'a AUCUNE page publique (aucune donnée exposée).
   * Index unique sparse : les comptes sans handle ne se collisionnent pas.
   */
  handle?: string;
  /**
   * Bio d'instructeur GÉNÉRÉE par LLM depuis le catalogue publié, persistée ici
   * et régénérable depuis les réglages. Validée par instructorBioSchema (Zod).
   * Additive : absente = la page publique n'affiche pas de bloc bio.
   */
  instructorBio?: {
    headline: string;
    bio: string;
    expertise: string[];
    generatedAt: Date;
  };
  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = HydratedDocument<IUser>;

const userSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    plan: { type: String, enum: PLAN_IDS, default: 'free' },
    quotaUsed: {
      coursesThisMonth: { type: Number, default: 0, min: 0 },
      periodStart: { type: Date, default: Date.now },
    },
    locale: { type: String, enum: [...LOCALES], default: 'fr' },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    banned: { type: Boolean, default: false },
    clonedVoiceId: { type: String },
    voiceCloneStatus: { type: String, enum: ['none', 'pending', 'ready', 'failed'], default: 'none' },
    voiceCloneConsent: { type: Boolean, default: false },
    voiceSampleUploadedAt: { type: Date },
    voiceCloneSampleSeconds: { type: Number, min: 0 },
    pendingReferralCode: { type: String, default: null },
    preferLargeText: { type: Boolean, default: false },
    billingTaxStatus: {
      type: String,
      enum: ['auto_entrepreneur', 'company', 'unspecified'],
      default: 'unspecified',
    },
    billingIce: { type: String, trim: true },
    billingIf: { type: String, trim: true },
    billingCompanyName: { type: String, trim: true },
    billingAddress: { type: String, trim: true },
    isAgency: { type: Boolean, default: false },
    avatarFaceUploadedAt: { type: Date },
    // unique + sparse : un seul porteur par handle, mais autant de comptes sans
    // handle que voulu (la majorité des utilisateurs n'a pas de page publique).
    handle: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
    instructorBio: {
      type: new Schema(
        {
          headline: { type: String, required: true, trim: true },
          bio: { type: String, required: true, trim: true },
          expertise: { type: [String], default: [] },
          generatedAt: { type: Date, default: Date.now },
        },
        { _id: false },
      ),
      required: false,
    },
  },
  { timestamps: true },
);

// Pattern hot-reload safe (Next) : réutilise le modèle déjà compilé.
export const User: Model<IUser> =
  (mongoose.models.User as Model<IUser> | undefined) ?? model<IUser>('User', userSchema);
