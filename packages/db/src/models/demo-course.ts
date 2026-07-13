// Défaut + destructuration : l'export nommé `models` de mongoose (CJS) n'est
// pas détecté par le lexer de Node ESM (worker exécuté via tsx).
import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type Model,
} from 'mongoose';

/**
 * Mini cours de démo public (Prompt 96) — généré depuis la landing (P95) par
 * un visiteur anonyme, TOUJOURS en mode mock (jamais d'appel payant). Stocké
 * temporairement : `expiresAt` porte un index TTL Mongo natif (expireAfterSeconds:0)
 * qui supprime le document automatiquement 24h après sa création, sans cron
 * applicatif à maintenir. Aucun lien avec Course/User — isolé du modèle
 * de données payant.
 */

export const DEMO_COURSE_TTL_HOURS = 24;

/** Une slide minimale de l'aperçu (sous-ensemble de slideScriptSchema, pas de TTS réel). */
export interface IDemoSlide {
  heading: string;
  bullets: string[];
  narration: string;
}

export interface IDemoLesson {
  title: string;
  type: string;
  durationMin: number;
  slides: IDemoSlide[];
}

export interface IDemoCourse {
  title: string;
  /** IP source (hachée en amont par l'appelant si besoin) — audit anti-abus uniquement. */
  requesterIp: string;
  section: {
    title: string;
    lessons: IDemoLesson[];
  };
  /** Toujours true : garde-fou explicite, aucune génération démo n'est jamais payante. */
  mock: true;
  createdAt: Date;
  updatedAt: Date;
  /** Purge automatique par MongoDB (index TTL) 24h après création. */
  expiresAt: Date;
}

export type DemoCourseDocument = HydratedDocument<IDemoCourse>;

const demoSlideSchema = new Schema<IDemoSlide>(
  {
    heading: { type: String, required: true },
    bullets: { type: [String], default: [] },
    narration: { type: String, required: true },
  },
  { _id: false },
);

const demoLessonSchema = new Schema<IDemoLesson>(
  {
    title: { type: String, required: true },
    type: { type: String, required: true },
    durationMin: { type: Number, required: true, min: 0 },
    slides: { type: [demoSlideSchema], default: [] },
  },
  { _id: false },
);

const demoCourseSchema = new Schema<IDemoCourse>(
  {
    title: { type: String, required: true, trim: true },
    requesterIp: { type: String, required: true },
    section: {
      title: { type: String, required: true },
      lessons: { type: [demoLessonSchema], default: [] },
    },
    mock: { type: Boolean, required: true, default: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// TTL Mongo natif : le document est supprimé par mongod dès que `expiresAt` est dépassé
// (le job de purge tourne côté serveur toutes les ~60s, pas de cron applicatif requis).
demoCourseSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const DemoCourse: Model<IDemoCourse> =
  (mongoose.models.DemoCourse as Model<IDemoCourse> | undefined) ??
  model<IDemoCourse>('DemoCourse', demoCourseSchema);
