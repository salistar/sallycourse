// Défaut + destructuration : l'export nommé `models` de mongoose (CJS) n'est
// pas détecté par le lexer de Node ESM (worker exécuté via tsx).
import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';

// Gamification du LMS interne (Prompt 200) — deux collections :
//
//  1) GamificationProfile : l'état GLOBAL d'un apprenant (XP cumulé, niveau,
//     streak quotidien en jour UTC, badges obtenus, opt-out du classement).
//     Un document par utilisateur (index unique) — créé à la première leçon
//     terminée (upsert depuis apps/web/src/lib/gamification-award.ts).
//
//  2) CourseXp : l'XP gagné PAR COURS, seule source du classement d'un cours
//     (index (courseId, xp desc) → top N sans scan). Additif : le total global
//     reste porté par le profil, jamais recalculé depuis cette collection.
//
// Aucune règle métier ici : le barème, la courbe de niveaux, les streaks et le
// catalogue de badges vivent dans packages/shared/src/gamification.ts (pur).

/** Badge obtenu, daté (l'ordre d'obtention alimente l'UI). */
export interface IEarnedBadge {
  /** Id du catalogue partagé (BADGE_IDS) — voir @sallycourse/shared/gamification. */
  id: string;
  earnedAt: Date;
}

export interface IGamificationProfile {
  userId: Types.ObjectId;
  /** XP cumulé, tous cours confondus (source du niveau). */
  totalXp: number;
  /** Niveau dérivé de totalXp (dénormalisé : évite un recalcul à chaque lecture). */
  level: number;
  /** Série de jours consécutifs d'activité (jour UTC). */
  currentStreak: number;
  /** Record personnel de série. */
  longestStreak: number;
  /** Dernier jour UTC d'activité, « YYYY-MM-DD » (dayKeyUtc). */
  lastActiveDay?: string;
  /** Badges obtenus (jamais retirés). */
  badges: IEarnedBadge[];
  /** L'apprenant refuse d'apparaître nominativement au classement → « Apprenant ». */
  leaderboardOptOut: boolean;
  /**
   * Dernier jour UTC pour lequel un rappel de streak a été envoyé — garde-fou
   * d'idempotence du cron (apps/worker/src/lib/streak-reminder.ts) : au plus un
   * rappel par jour, même si le job est rejoué.
   */
  lastStreakReminderDay?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type GamificationProfileDocument = HydratedDocument<IGamificationProfile>;

const earnedBadgeSchema = new Schema<IEarnedBadge>(
  {
    id: { type: String, required: true, trim: true },
    earnedAt: { type: Date, required: true },
  },
  { _id: false },
);

const gamificationProfileSchema = new Schema<IGamificationProfile>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    totalXp: { type: Number, default: 0, min: 0 },
    level: { type: Number, default: 1, min: 1 },
    currentStreak: { type: Number, default: 0, min: 0 },
    longestStreak: { type: Number, default: 0, min: 0 },
    lastActiveDay: { type: String, trim: true },
    badges: { type: [earnedBadgeSchema], default: [] },
    leaderboardOptOut: { type: Boolean, default: false },
    lastStreakReminderDay: { type: String, trim: true },
  },
  { timestamps: true },
);

// Balayage du cron de rappel : profils avec une série en cours, triés/filtrés
// sur le dernier jour actif (les séries en danger ont lastActiveDay = hier).
gamificationProfileSchema.index({ currentStreak: 1, lastActiveDay: 1 });

// Pattern hot-reload safe (Next) : réutilise le modèle déjà compilé.
export const GamificationProfile: Model<IGamificationProfile> =
  (mongoose.models.GamificationProfile as Model<IGamificationProfile> | undefined) ??
  model<IGamificationProfile>('GamificationProfile', gamificationProfileSchema);

export interface ICourseXp {
  studentId: Types.ObjectId;
  courseId: Types.ObjectId;
  /** XP gagné dans ce cours (incrémental, jamais recalculé). */
  xp: number;
  createdAt: Date;
  updatedAt: Date;
}

export type CourseXpDocument = HydratedDocument<ICourseXp>;

const courseXpSchema = new Schema<ICourseXp>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    xp: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

// Une ligne par (apprenant, cours) : $inc idempotent en upsert.
courseXpSchema.index({ studentId: 1, courseId: 1 }, { unique: true });
// Classement d'un cours : top N par XP décroissant, servi par l'index seul.
courseXpSchema.index({ courseId: 1, xp: -1 });

export const CourseXp: Model<ICourseXp> =
  (mongoose.models.CourseXp as Model<ICourseXp> | undefined) ??
  model<ICourseXp>('CourseXp', courseXpSchema);
