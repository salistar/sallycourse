// Défaut + destructuration : l'export nommé `models` de mongoose (CJS) n'est
// pas détecté par le lexer de Node ESM (worker exécuté via tsx).
import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';
// Import sur une seule ligne : le @ts-ignore neutralise TS6059/TS2305 quand ce
// fichier est consommé en source par le worker (NodeNext) ; typage intact ici (Bundler).
// prettier-ignore
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext)
import { LOCALES, courseStatusSchema, difficultySchema, outlineSchema, type CourseStatus, type Difficulty, type Locale, type Outline } from '@sallycourse/shared';

export interface ICourse {
  userId: Types.ObjectId;
  title: string;
  difficulty: Difficulty;
  status: CourseStatus;
  /** Plan de cours — Mixed en base mais validé par outlineSchema (Zod). */
  outline?: Outline | null;
  targetPlatforms: string[];
  locale: Locale;
  /** Filigrane discret exigé selon le plan à la création (free=true) — P53. */
  watermark: boolean;
  ttsVoice?: string;
  coverImageUrl?: string;
  /** Clé S3 de la vidéo d'intro webcam (~60 s) — mode compliance max Udemy (P48). */
  introVideoKey?: string;
  qaReport?: unknown;
  /** Landing marketing générée (JSON marketingSchema + clés S3 des visuels) — Mixed. */
  marketing?: unknown;
  /**
   * Analyse des retours étudiants (P62) : thèmes récurrents + suggestions
   * d'amélioration ciblées, produites par le worker à partir des avis Udemy.
   * Mixed en base, validé par reviewAnalysisSchema (Zod). Null tant qu'aucune
   * analyse n'a tourné.
   */
  improvementSuggestions?: unknown;
  /**
   * Mention IA générée acceptée par l'auteur (P66, RGPD/légal) — case à
   * cocher OBLIGATOIRE avant tout déploiement vers Udemy (transparence
   * contenu généré par IA). Bloque le déploiement udemy tant que false.
   */
  aiDisclosureAccepted: boolean;
  /**
   * Ressources téléchargeables enrichies (P65) : cheat sheet PDF, workbook PDF,
   * glossaire et liste « pour aller plus loin », générées en fin de pipeline.
   * Mixed en base (clés S3 + statut) ; null tant qu'aucune génération n'a tourné.
   */
  resources?: unknown;
  /**
   * Archivage à froid (P79) : true si le cours est inactif depuis 90+ jours
   * (voir lib/retention.ts côté worker). Un cours archivé reste consultable
   * mais est exclu des listings actifs ; réactivable via
   * POST /api/courses/[id]/reactivate (ré-enqueue depuis Lesson.script, sans
   * rappel LLM). Champ additif, default false — ne modifie aucun comportement
   * existant pour les cours jamais archivés.
   */
  archived?: boolean;
  /** Date de bascule en archivé (null si jamais archivé ou réactivé). */
  archivedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CourseDocument = HydratedDocument<ICourse>;

const courseSchema = new Schema<ICourse>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true },
    difficulty: { type: String, enum: [...difficultySchema.options], required: true },
    status: { type: String, enum: [...courseStatusSchema.options], default: 'draft' },
    outline: {
      type: Schema.Types.Mixed,
      default: null,
      validate: {
        validator: (v: unknown) => v == null || outlineSchema.safeParse(v).success,
        message: 'outline invalide (ne respecte pas outlineSchema)',
      },
    },
    targetPlatforms: { type: [String], default: [] },
    locale: { type: String, enum: [...LOCALES], default: 'fr' },
    watermark: { type: Boolean, default: true },
    ttsVoice: { type: String },
    coverImageUrl: { type: String },
    introVideoKey: { type: String },
    qaReport: { type: Schema.Types.Mixed, default: null },
    marketing: { type: Schema.Types.Mixed, default: null },
    improvementSuggestions: { type: Schema.Types.Mixed, default: null },
    aiDisclosureAccepted: { type: Boolean, default: false },
    resources: { type: Schema.Types.Mixed, default: null },
    archived: { type: Boolean, default: false },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Listing des cours d'un utilisateur, du plus récent au plus ancien.
courseSchema.index({ userId: 1, createdAt: -1 });

export const Course: Model<ICourse> =
  (mongoose.models.Course as Model<ICourse> | undefined) ?? model<ICourse>('Course', courseSchema);
