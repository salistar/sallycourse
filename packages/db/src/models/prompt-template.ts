import {
  Schema,
  model,
  models,
  type HydratedDocument,
  type Model,
} from 'mongoose';

// Playground de prompts admin (Prompt 93). Chaque clé (ex. "outline.system")
// identifie un prompt en dur dans apps/worker/src/prompts/*.ts. Une entrée
// active en base SURCHARGE ce prompt (voir apps/worker/src/lib/prompt-registry.ts
// — getActivePrompt() retombe sur le contenu en dur si absente). Migration
// non destructive : aucune ligne n'est requise pour que le pipeline continue
// de fonctionner à l'identique.

export interface IPromptTemplate {
  /** Identifiant stable du prompt (ex. "outline.system", "quiz.user"). */
  key: string;
  /** Contenu du prompt — remplace intégralement le prompt en dur si actif. */
  content: string;
  /** Version incrémentale (1 à la création, +1 à chaque modification de contenu). */
  version: number;
  /** Une seule version active par clé — c'est elle que getActivePrompt() lit. */
  isActive: boolean;
  /** Email/identifiant de l'admin ayant créé cette version. */
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export type PromptTemplateDocument = HydratedDocument<IPromptTemplate>;

const promptTemplateSchema = new Schema<IPromptTemplate>(
  {
    key: { type: String, required: true, trim: true, index: true },
    content: { type: String, required: true },
    version: { type: Number, required: true, default: 1, min: 1 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: String, required: true, trim: true },
  },
  { timestamps: true },
);

// Une seule version active par clé à la fois (l'appli applicative garantit
// la désactivation des précédentes avant d'activer la nouvelle).
promptTemplateSchema.index({ key: 1, isActive: 1 });
promptTemplateSchema.index({ key: 1, version: -1 });

export const PromptTemplate: Model<IPromptTemplate> =
  (models.PromptTemplate as Model<IPromptTemplate> | undefined) ??
  model<IPromptTemplate>('PromptTemplate', promptTemplateSchema);
