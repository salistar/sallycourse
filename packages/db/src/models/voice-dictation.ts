// Défaut + destructuration : l'export nommé `models` de mongoose (CJS) n'est
// pas détecté par le lexer de Node ESM (worker exécuté via tsx).
import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';

// Dictée vocale de création de cours (Prompt 210). Un VoiceDictation = un
// enregistrement audio uploadé par un utilisateur, transcrit par faster-whisper
// puis interprété (LLM) en un « brief » de cours. Le flux est ASYNCHRONE : la
// route web crée le document en 'pending', enfile un job voice-intake, et le
// client POLLE ce document (le worker n'expose aucun HTTP). Modèle ADDITIF —
// n'affecte aucune collection existante.

export const VOICE_DICTATION_STATUSES = ['pending', 'transcribing', 'ready', 'failed'] as const;
export type VoiceDictationStatus = (typeof VOICE_DICTATION_STATUSES)[number];

/** Langue d'ENTRÉE déclarée (darija = entrée uniquement, transcrite en arabe). */
export const VOICE_DICTATION_INPUT_LANGS = ['darija', 'ar', 'fr'] as const;
export type VoiceDictationInputLang = (typeof VOICE_DICTATION_INPUT_LANGS)[number];

export interface IVoiceDictation {
  /** Propriétaire de la dictée (ownership : 404 si un autre y accède). */
  userId: Types.ObjectId;
  status: VoiceDictationStatus;
  inputLang: VoiceDictationInputLang;
  /** Clé S3 de l'audio uploadé (voice-dictations/{userId}/{id}.audio). */
  audioKey: string;
  /** Transcription brute produite par faster-whisper (peut être imparfaite). */
  transcript?: string;
  /** Brief structuré interprété par le LLM (conforme à dictationBriefSchema). */
  brief?: unknown;
  /** Message d'erreur lisible en cas d'échec (transcription/compréhension). */
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type VoiceDictationDocument = HydratedDocument<IVoiceDictation>;

const voiceDictationSchema = new Schema<IVoiceDictation>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: [...VOICE_DICTATION_STATUSES], default: 'pending', index: true },
    inputLang: { type: String, enum: [...VOICE_DICTATION_INPUT_LANGS], default: 'fr' },
    audioKey: { type: String, required: true },
    transcript: { type: String },
    // Brief libre (validé par dictationBriefSchema à l'écriture/lecture) — Mixed
    // comme les autres sous-documents « contenu généré » du repo (Course.resources).
    brief: { type: Schema.Types.Mixed },
    error: { type: String },
  },
  { timestamps: true },
);

// Purge/liste des dictées récentes d'un utilisateur, plus récentes d'abord.
voiceDictationSchema.index({ userId: 1, createdAt: -1 });

export const VoiceDictation: Model<IVoiceDictation> =
  (mongoose.models.VoiceDictation as Model<IVoiceDictation> | undefined) ??
  model<IVoiceDictation>('VoiceDictation', voiceDictationSchema);
