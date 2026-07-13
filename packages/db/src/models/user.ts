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
  },
  { timestamps: true },
);

// Pattern hot-reload safe (Next) : réutilise le modèle déjà compilé.
export const User: Model<IUser> =
  (mongoose.models.User as Model<IUser> | undefined) ?? model<IUser>('User', userSchema);
