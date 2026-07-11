import {
  Schema,
  model,
  models,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';

// Clip court issu du repurposing TikTok/Instagram/Shorts d'une leçon vidéo
// (Prompt 106). Un ShortClip = un extrait 9:16 découpé + sous-titré + publié
// (ou planifié) sur une plateforme courte. Modèle ADDITIF — n'affecte aucune
// collection existante ; une leçon peut engendrer 0..N clips.

export const SHORT_CLIP_PLATFORMS = ['tiktok', 'instagram'] as const;
export type ShortClipPlatform = (typeof SHORT_CLIP_PLATFORMS)[number];

export const SHORT_CLIP_STATUSES = [
  'draft',
  'scheduled',
  'published',
  'failed',
] as const;
export type ShortClipStatus = (typeof SHORT_CLIP_STATUSES)[number];

export interface IShortClip {
  courseId: Types.ObjectId;
  lessonId: Types.ObjectId;
  platform: ShortClipPlatform;
  /** Position 0-based du clip parmi ceux générés pour la leçon (ordre de publication). */
  order: number;
  /** Accroche courte (3-5 mots) générée par callClaudeJson. */
  hook: string;
  /** Borne de départ/fin dans la vidéo source (secondes), segment le plus dense retenu. */
  startSec: number;
  endSec: number;
  /** Clé de stockage S3 du clip vertical rendu (9:16, sous-titres incrustés). */
  videoKey: string;
  status: ShortClipStatus;
  /** Horodatage de publication programmée (mode simulé ou réel). */
  scheduledAt?: Date;
  /** Identifiant renvoyé par la plateforme après publication (mock ou réel). */
  externalId?: string;
  externalUrl?: string;
  /** Compte plateforme utilisé (PlatformCredential) — multi-comptes, cohérent avec Deployment. */
  credentialId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type ShortClipDocument = HydratedDocument<IShortClip>;

const shortClipSchema = new Schema<IShortClip>(
  {
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    lessonId: { type: Schema.Types.ObjectId, ref: 'Lesson', required: true, index: true },
    platform: { type: String, enum: [...SHORT_CLIP_PLATFORMS], required: true },
    order: { type: Number, required: true, min: 0 },
    hook: { type: String, required: true, trim: true },
    startSec: { type: Number, required: true, min: 0 },
    endSec: { type: Number, required: true, min: 0 },
    videoKey: { type: String, required: true },
    status: { type: String, enum: [...SHORT_CLIP_STATUSES], default: 'draft' },
    scheduledAt: { type: Date },
    externalId: { type: String },
    externalUrl: { type: String },
    credentialId: { type: Schema.Types.ObjectId, ref: 'PlatformCredential' },
  },
  { timestamps: true },
);

shortClipSchema.index({ courseId: 1, platform: 1, order: 1 });

export const ShortClip: Model<IShortClip> =
  (models.ShortClip as Model<IShortClip> | undefined) ??
  model<IShortClip>('ShortClip', shortClipSchema);
