import { Schema, model, models, type HydratedDocument, type Model } from 'mongoose';
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
  },
  { timestamps: true },
);

// Pattern hot-reload safe (Next) : réutilise le modèle déjà compilé.
export const User: Model<IUser> =
  (models.User as Model<IUser> | undefined) ?? model<IUser>('User', userSchema);
