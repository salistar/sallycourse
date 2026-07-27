import type { LessonType } from '@sallycourse/shared';

/**
 * DTO sérialisables du LMS interne (Prompt 43) passés du Server Component à
 * l'expérience client. Les URLs vidéo/sous-titres sont déjà présignées ; le
 * Markdown des articles est déjà résolu ; les questions de quiz sont inlinées.
 */

export interface LearnQuizQuestionView {
  question: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
}

/** Liens vers un projet interactif ouvrable dans un IDE en ligne (P84). */
export interface LearnSandboxProjectLinks {
  stackblitzUrl: string;
  codesandboxUrl: string;
}

export interface LearnSandboxLinksView {
  language: string;
  starter: LearnSandboxProjectLinks;
  solution: LearnSandboxProjectLinks;
}

export interface LearnLessonView {
  id: string;
  sectionId: string;
  title: string;
  type: LessonType;
  durationMin: number;
  /** URL présignée de la vidéo (leçon 'video'), sinon undefined. */
  videoUrl?: string;
  /** URL présignée de la piste VTT (sous-titres), sinon undefined. */
  captionsUrl?: string;
  /** URL présignée de la transcription texte brut (P137, accessibilité), sinon undefined. */
  transcriptUrl?: string;
  /** Markdown résolu (leçon 'article'), sinon undefined. */
  articleMd?: string;
  /** Questions du quiz (leçon 'quiz'), sinon tableau vide. */
  quiz: LearnQuizQuestionView[];
  /** Liens StackBlitz/CodeSandbox (leçon 'tp' de code, P84), sinon undefined. */
  sandboxLinks?: LearnSandboxLinksView;
}

export interface LearnSectionView {
  id: string;
  title: string;
  order: number;
}

export interface LearnCourseView {
  id: string;
  title: string;
  summary: string;
  sections: LearnSectionView[];
  lessons: LearnLessonView[];
  priceCents: number;
  currency: string;
}

/* ------------------------------------------------------------------ */
/* Gamification (Prompt 200) — DTO client                              */
/* ------------------------------------------------------------------ */

/** Badge affiché dans le HUD (catalogue partagé, résolu côté serveur). */
export interface GamificationBadgeView {
  id: string;
  label: string;
  description: string;
  /** Clé d'icône du catalogue (@sallycourse/shared/gamification). */
  icon: string;
  /** ISO — présent uniquement pour un badge obtenu. */
  earnedAt?: string;
}

/** Progression dans le niveau courant (miroir de LevelProgress, sérialisé). */
export interface GamificationLevelProgressView {
  level: number;
  levelStartXp: number;
  nextLevelXp: number;
  xpIntoLevel: number;
  xpRemaining: number;
  percent: number;
}

/** Réponse de GET /api/learn/gamification. */
export interface GamificationProfileView {
  totalXp: number;
  level: number;
  levelProgress: GamificationLevelProgressView;
  currentStreak: number;
  longestStreak: number;
  lastActiveDay: string | null;
  leaderboardOptOut: boolean;
  badges: GamificationBadgeView[];
  catalogue: GamificationBadgeView[];
}

/** Delta renvoyé par POST /api/learn/[courseId]/track à la 1re complétion. */
export interface GamificationAwardView {
  xp: { lesson: number; quiz: number; dailyBonus: number; total: number };
  totalXp: number;
  courseXp: number;
  level: number;
  previousLevel: number;
  leveledUp: boolean;
  levelProgress: GamificationLevelProgressView;
  streak: { current: number; longest: number; extended: boolean; broken: boolean };
  newBadges: GamificationBadgeView[];
}

/** Ligne du classement d'un cours (GET /api/learn/[courseId]/leaderboard). */
export interface LeaderboardRowView {
  rank: number;
  studentId: string;
  xp: number;
  /** « Prénom I. » ou « Apprenant » (opt-out) — jamais l'email. */
  displayName: string;
  isViewer: boolean;
}
