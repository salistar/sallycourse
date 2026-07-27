// Presets de GÉNÉRATION nommés (Phase 10, P163/174) : un preset mémorise un jeu
// de paramètres de création réutilisable en un clic (« mes réglages DevOps »).
// Distinct de DeployPreset (P109) qui concerne le DÉPLOIEMENT. `params` = un
// sous-ensemble de createCourseInput (hors `title`) stocké en Mixed, validé par
// createCourseInputSchema.partial() côté route. isPublic → partage lecture seule.
import mongoose, { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

/** Paramètres de génération mémorisés (sous-ensemble de createCourseInput, sans le titre). */
export interface IGenerationPresetParams {
  difficulty?: string;
  locale?: string;
  ttsVoice?: string;
  targetPlatforms?: string[];
  approxSections?: number;
  generationMode?: 'auto' | 'validated';
  llmProvider?: string;
  avatarEnabled?: boolean;
  useCustomVoice?: boolean;
  // Paramètres avancés (structure/pédagogie/domaine/voix) — Mixed, validé par advancedParamsSchema.
  advancedParams?: Record<string, unknown>;
}

export interface IGenerationPreset {
  userId: Types.ObjectId;
  name: string;
  params: IGenerationPresetParams;
  /** Partage en lecture seule avec les autres utilisateurs (bibliothèque de presets). */
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type GenerationPresetDocument = HydratedDocument<IGenerationPreset>;

const generationPresetSchema = new Schema<IGenerationPreset>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    params: { type: Schema.Types.Mixed, default: {} },
    isPublic: { type: Boolean, default: false },
  },
  { timestamps: true },
);

generationPresetSchema.index({ userId: 1, updatedAt: -1 });
generationPresetSchema.index({ isPublic: 1, updatedAt: -1 });

export const GenerationPreset: Model<IGenerationPreset> =
  (mongoose.models.GenerationPreset as Model<IGenerationPreset> | undefined) ??
  model<IGenerationPreset>('GenerationPreset', generationPresetSchema);
