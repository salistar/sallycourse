// Défaut + destructuration : l'export nommé `models` de mongoose (CJS) n'est
// pas détecté par le lexer de Node ESM (worker exécuté via tsx).
import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';

// Séquences email marketing (Prompt 140) — étend le service d'email existant
// (P59, packages/db/src/email/) avec des scénarios multi-étapes programmés :
// annonce de lancement, nurturing, relance des inactifs (LMS interne, P43).
// Une EmailSequence décrit le scénario (steps, délais) ; une
// EmailSequenceEnrollment suit la progression d'UN destinataire dans UNE
// séquence (prochaine étape due, historique d'envoi).

/** Nature de la séquence — pilote le générateur LLM et le déclencheur cron. */
export const EMAIL_SEQUENCE_KINDS = ['launch', 'nurturing', 'winback'] as const;
export type EmailSequenceKind = (typeof EMAIL_SEQUENCE_KINDS)[number];

/** Une étape de la séquence : délai depuis l'inscription + contenu du gabarit. */
export interface IEmailSequenceStep {
  /** Jours après l'inscription à la séquence (0 = immédiat). */
  delayDays: number;
  subject: string;
  /** Corps HTML — interpolé avec {{name}}/{{courseTitle}} au moment de l'envoi. */
  bodyTemplate: string;
}

export interface IEmailSequence {
  /** Propriétaire du cours (ou du compte, si séquence globale). */
  userId: Types.ObjectId;
  /** Cours ciblé ; absent = séquence globale (tous cours de l'utilisateur). */
  courseId?: Types.ObjectId;
  kind: EmailSequenceKind;
  name: string;
  steps: IEmailSequenceStep[];
  /** Séquence active : seules les séquences actives sont éligibles à l'inscription auto. */
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type EmailSequenceDocument = HydratedDocument<IEmailSequence>;

const emailSequenceStepSchema = new Schema<IEmailSequenceStep>(
  {
    delayDays: { type: Number, required: true, min: 0 },
    subject: { type: String, required: true, trim: true },
    bodyTemplate: { type: String, required: true },
  },
  { _id: false },
);

const emailSequenceSchema = new Schema<IEmailSequence>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    courseId: { type: Schema.Types.ObjectId, ref: 'Course' },
    kind: { type: String, enum: [...EMAIL_SEQUENCE_KINDS], required: true },
    name: { type: String, required: true, trim: true },
    steps: { type: [emailSequenceStepSchema], default: [] },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

emailSequenceSchema.index({ userId: 1, courseId: 1 });

export const EmailSequence: Model<IEmailSequence> =
  (mongoose.models.EmailSequence as Model<IEmailSequence> | undefined) ??
  model<IEmailSequence>('EmailSequence', emailSequenceSchema);

/* ------------------------------------------------------------------ */
/* Inscription d'un destinataire à une séquence — suit la progression  */
/* ------------------------------------------------------------------ */

export const EMAIL_SEQUENCE_ENROLLMENT_STATUSES = ['active', 'completed', 'cancelled'] as const;
export type EmailSequenceEnrollmentStatus = (typeof EMAIL_SEQUENCE_ENROLLMENT_STATUSES)[number];

export interface IEmailSequenceEnrollment {
  sequenceId: Types.ObjectId;
  /** Destinataire — Types.ObjectId si étudiant interne (User), sinon email brut (contact CRM externe). */
  studentId?: Types.ObjectId;
  /** Email effectif d'envoi (toujours renseigné, dérivé de studentId ou fourni directement). */
  email: string;
  /** Nom d'affichage pour l'interpolation ({{name}}). */
  name?: string;
  /** Titre du cours pour l'interpolation ({{courseTitle}}) — figé à l'inscription. */
  courseTitle?: string;
  /** Index de la prochaine étape à envoyer (steps[nextStepIndex]). */
  nextStepIndex: number;
  /** Date/heure du prochain envoi dû — le cron ne traite que nextSendAt <= now. */
  nextSendAt: Date;
  status: EmailSequenceEnrollmentStatus;
  /** Historique des étapes déjà envoyées (index + date). */
  sentSteps: { stepIndex: number; sentAt: Date }[];
  createdAt: Date;
  updatedAt: Date;
}

export type EmailSequenceEnrollmentDocument = HydratedDocument<IEmailSequenceEnrollment>;

const sentStepSchema = new Schema<{ stepIndex: number; sentAt: Date }>(
  {
    stepIndex: { type: Number, required: true },
    sentAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const emailSequenceEnrollmentSchema = new Schema<IEmailSequenceEnrollment>(
  {
    sequenceId: { type: Schema.Types.ObjectId, ref: 'EmailSequence', required: true, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'User' },
    email: { type: String, required: true, trim: true, lowercase: true },
    name: { type: String, trim: true },
    courseTitle: { type: String, trim: true },
    nextStepIndex: { type: Number, default: 0, min: 0 },
    nextSendAt: { type: Date, required: true, index: true },
    status: { type: String, enum: [...EMAIL_SEQUENCE_ENROLLMENT_STATUSES], default: 'active' },
    sentSteps: { type: [sentStepSchema], default: [] },
  },
  { timestamps: true },
);

// Un seul enrollment actif par (séquence, email) — évite les doublons d'envoi.
emailSequenceEnrollmentSchema.index({ sequenceId: 1, email: 1 }, { unique: true });
// Index d'interrogation du cron : statut actif + échéance due.
emailSequenceEnrollmentSchema.index({ status: 1, nextSendAt: 1 });

export const EmailSequenceEnrollment: Model<IEmailSequenceEnrollment> =
  (mongoose.models.EmailSequenceEnrollment as Model<IEmailSequenceEnrollment> | undefined) ??
  model<IEmailSequenceEnrollment>('EmailSequenceEnrollment', emailSequenceEnrollmentSchema);
