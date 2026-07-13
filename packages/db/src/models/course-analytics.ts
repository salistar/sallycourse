// Défaut + destructuration : l'export nommé `models` de mongoose (CJS) n'est
// pas détecté par le lexer de Node ESM (worker exécuté via tsx).
import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';

// Métriques d'un cours publié, par plateforme (Prompt 61). Une ligne = le
// dernier instantané des métriques d'un cours sur UNE plateforme (Udemy,
// YouTube…). Alimenté par le job de rafraîchissement (worker, repeatable) qui
// interroge les providers analytics (Instructor API Udemy, Analytics API
// YouTube — MOCK par défaut). Le dashboard agrège ces lignes par cours pour un
// tableau consolidé multi-plateformes.

/** Plateformes suivies pour l'analytics (sous-ensemble des cibles de déploiement). */
export const ANALYTICS_PLATFORMS = ['udemy', 'youtube'] as const;
export type AnalyticsPlatform = (typeof ANALYTICS_PLATFORMS)[number];

export interface ICourseAnalytics {
  courseId: Types.ObjectId;
  /** Propriétaire du cours (dénormalisé pour filtrer sans jointure). */
  userId: Types.ObjectId;
  /** Plateforme source des métriques (udemy, youtube…). */
  platform: string;
  /** Nombre d'inscrits / d'acheteurs (Udemy) — 0 si non applicable. */
  enrollments: number;
  /** Note moyenne 0–5 (0 = non noté). */
  rating: number;
  /** Revenu cumulé en USD attribué à la plateforme. */
  revenue: number;
  /** Nombre de vues (YouTube) — 0 si non applicable. */
  views: number;
  /** Instant de récupération des métriques. */
  fetchedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type CourseAnalyticsDocument = HydratedDocument<ICourseAnalytics>;

const courseAnalyticsSchema = new Schema<ICourseAnalytics>(
  {
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    platform: { type: String, required: true, trim: true },
    enrollments: { type: Number, default: 0, min: 0 },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    revenue: { type: Number, default: 0, min: 0 },
    views: { type: Number, default: 0, min: 0 },
    fetchedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

// Un seul instantané courant par (cours, plateforme) : upsert idempotent.
courseAnalyticsSchema.index({ courseId: 1, platform: 1 }, { unique: true });

export const CourseAnalytics: Model<ICourseAnalytics> =
  (mongoose.models.CourseAnalytics as Model<ICourseAnalytics> | undefined) ??
  model<ICourseAnalytics>('CourseAnalytics', courseAnalyticsSchema);
