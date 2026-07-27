// Gamification du LMS interne (Prompt 200) — logique PURE, sans I/O :
// barème XP, courbe de niveaux, streaks quotidiens (jour UTC), catalogue de
// badges et classement par cours. Les écritures (profil, XP par cours,
// notifications) restent dans apps/web/src/lib/gamification-award.ts (routes)
// et apps/worker/src/lib/streak-reminder.ts (cron) — ici, aucun accès Mongo.
//
// Décisions produit figées :
//  - Le « jour » d'un streak est le jour **UTC** (aucun fuseau par utilisateur).
//  - Le classement affiche « Prénom I. » (jamais l'email) ; opt-out → « Apprenant ».
//  - XP attribué UNE SEULE FOIS par leçon (à la première complétion) : la
//    détection de la première complétion est faite par l'appelant (route /track).

/* ------------------------------------------------------------------ */
/* 1) Barème XP                                                        */
/* ------------------------------------------------------------------ */

export const XP_RULES = {
  /** Toute leçon terminée (vidéo, article, TP, quiz) — première complétion seulement. */
  lessonCompleted: 10,
  /** Quiz : bonus additionnel selon le score (cumulé avec `lessonCompleted`). */
  quiz: {
    /** score < 50 */
    low: 5,
    /** 50 <= score < 80 */
    mid: 10,
    /** score >= 80 */
    high: 20,
  },
  /** Seuils de score (en %) départageant les paliers de quiz. */
  quizThresholds: {
    mid: 50,
    high: 80,
  },
  /** Bonus accordé à la PREMIÈRE leçon terminée du jour (UTC). */
  firstLessonOfDayBonus: 5,
  /**
   * Pas de la courbe de niveaux : l'XP cumulé requis pour ATTEINDRE le niveau
   * L vaut `levelStep * L * (L - 1)` — soit 0, 100, 300, 600, 1000, 1500…
   * (écart croissant de 100 XP par niveau : simple, lisible, sans plateau).
   */
  levelStep: 50,
} as const;

/** XP d'une leçon terminée (hors quiz, hors bonus quotidien). */
export function xpForLessonCompletion(): number {
  return XP_RULES.lessonCompleted;
}

/**
 * Bonus XP d'un quiz selon le score (0–100). Score hors bornes → ramené dans
 * [0, 100] (le player peut arrondir).
 */
export function xpForQuiz(score: number): number {
  const clamped = Math.max(0, Math.min(100, score));
  if (clamped >= XP_RULES.quizThresholds.high) return XP_RULES.quiz.high;
  if (clamped >= XP_RULES.quizThresholds.mid) return XP_RULES.quiz.mid;
  return XP_RULES.quiz.low;
}

export interface LessonXpInput {
  /** Score du quiz (0–100) si la leçon terminée est un quiz, sinon undefined. */
  quizScore?: number;
  /** true si c'est la première leçon terminée du jour UTC (bonus de régularité). */
  firstOfDay: boolean;
}

export interface LessonXpBreakdown {
  lesson: number;
  quiz: number;
  dailyBonus: number;
  total: number;
}

/** Décompose l'XP gagné à la complétion d'une leçon (PURE, tout est additif). */
export function xpForLessonEvent(input: LessonXpInput): LessonXpBreakdown {
  const lesson = xpForLessonCompletion();
  const quiz = typeof input.quizScore === 'number' ? xpForQuiz(input.quizScore) : 0;
  const dailyBonus = input.firstOfDay ? XP_RULES.firstLessonOfDayBonus : 0;
  return { lesson, quiz, dailyBonus, total: lesson + quiz + dailyBonus };
}

/* ------------------------------------------------------------------ */
/* 2) Niveaux                                                          */
/* ------------------------------------------------------------------ */

/** XP cumulé requis pour atteindre `level` (niveau 1 = 0 XP). */
export function xpForLevel(level: number): number {
  const l = Math.max(1, Math.floor(level));
  return XP_RULES.levelStep * l * (l - 1);
}

/** Niveau atteint avec `totalXp` (>= 1, croissant). */
export function levelForXp(totalXp: number): number {
  const xp = Math.max(0, totalXp);
  // Résolution directe de levelStep * L * (L-1) <= xp — arrondi vers le bas puis
  // corrigé par un pas (robuste aux imprécisions flottantes de Math.sqrt).
  const approx = Math.floor((1 + Math.sqrt(1 + (4 * xp) / XP_RULES.levelStep)) / 2);
  let level = Math.max(1, approx);
  while (xpForLevel(level + 1) <= xp) level += 1;
  while (level > 1 && xpForLevel(level) > xp) level -= 1;
  return level;
}

export interface LevelProgress {
  level: number;
  /** XP cumulé requis pour le niveau courant. */
  levelStartXp: number;
  /** XP cumulé requis pour le niveau suivant. */
  nextLevelXp: number;
  /** XP acquis à l'intérieur du niveau courant. */
  xpIntoLevel: number;
  /** XP restant avant le niveau suivant. */
  xpRemaining: number;
  /** Avancement dans le niveau courant (0–100, arrondi) — barre XP de l'UI. */
  percent: number;
}

/** Progression détaillée vers le niveau suivant (alimente la barre XP). */
export function xpToNextLevel(totalXp: number): LevelProgress {
  const xp = Math.max(0, totalXp);
  const level = levelForXp(xp);
  const levelStartXp = xpForLevel(level);
  const nextLevelXp = xpForLevel(level + 1);
  const span = nextLevelXp - levelStartXp;
  const xpIntoLevel = xp - levelStartXp;
  return {
    level,
    levelStartXp,
    nextLevelXp,
    xpIntoLevel,
    xpRemaining: Math.max(0, nextLevelXp - xp),
    percent: span > 0 ? Math.round((xpIntoLevel / span) * 100) : 0,
  };
}

/* ------------------------------------------------------------------ */
/* 3) Streaks quotidiens (jour UTC)                                    */
/* ------------------------------------------------------------------ */

/** Clé de jour UTC « YYYY-MM-DD » — unité de compte des streaks. */
export function dayKeyUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Clé du jour UTC précédant `date` (décalage en jours, négatif = passé). */
export function shiftDayKeyUtc(date: Date, days: number): string {
  const shifted = new Date(date.getTime() + days * 86_400_000);
  return dayKeyUtc(shifted);
}

export interface StreakState {
  currentStreak: number;
  longestStreak: number;
  /** Dernier jour UTC d'activité (« YYYY-MM-DD ») — null si aucune activité. */
  lastActiveDay?: string | null;
}

export interface StreakUpdate {
  current: number;
  longest: number;
  /** true si la série précédente a été rompue (>= 1 jour sauté). */
  broken: boolean;
  /** true si c'est la première activité du jour UTC (déclenche le bonus XP). */
  firstOfDay: boolean;
  /** Jour UTC de l'activité (à persister dans lastActiveDay). */
  day: string;
}

/**
 * Applique une activité datée `now` à l'état de streak. PURE : l'appelant
 * persiste `current`/`longest`/`day`.
 *  - même jour UTC  → série inchangée, pas de bonus quotidien ;
 *  - jour suivant   → série + 1 ;
 *  - trou (ou 1re activité) → série repart à 1 (`broken` si une série existait).
 */
export function updateStreak(state: StreakState, now: Date): StreakUpdate {
  const day = dayKeyUtc(now);
  const yesterday = shiftDayKeyUtc(now, -1);
  const last = state.lastActiveDay ?? null;
  const longestBefore = Math.max(0, state.longestStreak);
  const currentBefore = Math.max(0, state.currentStreak);

  if (last === day) {
    return {
      current: Math.max(1, currentBefore),
      longest: Math.max(longestBefore, Math.max(1, currentBefore)),
      broken: false,
      firstOfDay: false,
      day,
    };
  }

  const continued = last === yesterday;
  const current = continued ? currentBefore + 1 : 1;
  return {
    current,
    longest: Math.max(longestBefore, current),
    broken: !continued && last !== null,
    firstOfDay: true,
    day,
  };
}

/**
 * Série en danger : l'apprenant était actif HIER (UTC) mais pas encore
 * aujourd'hui — un jour de plus sans activité et la série tombe. Base du
 * rappel quotidien (worker) : ne cible que les séries réellement menacées.
 */
export function isStreakAtRisk(state: StreakState, now: Date): boolean {
  if (state.currentStreak < 1) return false;
  return (state.lastActiveDay ?? null) === shiftDayKeyUtc(now, -1);
}

/* ------------------------------------------------------------------ */
/* 4) Badges                                                           */
/* ------------------------------------------------------------------ */

export const BADGE_IDS = [
  'first_lesson',
  'first_tp',
  'perfect_quiz',
  'course_completed',
  'streak_7',
  'streak_30',
] as const;
export type BadgeId = (typeof BADGE_IDS)[number];

export interface BadgeDefinition {
  id: BadgeId;
  label: string;
  description: string;
  /** Clé d'icône résolue côté UI (lucide-react) — pas de JSX dans le pur. */
  icon: 'sparkles' | 'flask' | 'target' | 'award' | 'flame' | 'trophy';
}

/** Catalogue des badges (source de vérité, ordre d'affichage). */
export const BADGES: readonly BadgeDefinition[] = [
  {
    id: 'first_lesson',
    label: 'Premiers pas',
    description: 'Terminer sa première leçon.',
    icon: 'sparkles',
  },
  {
    id: 'first_tp',
    label: 'Mains dans le cambouis',
    description: 'Terminer son premier TP.',
    icon: 'flask',
  },
  {
    id: 'perfect_quiz',
    label: 'Sans faute',
    description: 'Obtenir 100 % à un quiz.',
    icon: 'target',
  },
  {
    id: 'course_completed',
    label: 'Cours bouclé',
    description: 'Terminer toutes les leçons d’un cours.',
    icon: 'award',
  },
  {
    id: 'streak_7',
    label: 'Série de 7 jours',
    description: 'Apprendre 7 jours d’affilée.',
    icon: 'flame',
  },
  {
    id: 'streak_30',
    label: 'Série de 30 jours',
    description: 'Apprendre 30 jours d’affilée.',
    icon: 'trophy',
  },
];

/** Recherche une définition de badge par id (undefined si inconnu). */
export function findBadge(id: string): BadgeDefinition | undefined {
  return BADGES.find((b) => b.id === id);
}

export interface BadgeState {
  /** Badges déjà obtenus (ids) — jamais re-attribués. */
  earned: readonly string[];
  /** Nombre total de leçons terminées (tous cours confondus). */
  lessonsCompleted: number;
  /** Nombre de TP terminés. */
  tpCompleted: number;
  /** Au moins un quiz à 100 %. */
  hasPerfectQuiz: boolean;
  /** Nombre de cours entièrement terminés. */
  coursesCompleted: number;
  /** Série en cours (jours). */
  currentStreak: number;
}

/**
 * Badges NOUVELLEMENT débloqués par cet état (déjà obtenus exclus). PURE :
 * l'appelant persiste le résultat et notifie.
 */
export function evaluateBadges(state: BadgeState): BadgeId[] {
  const earned = new Set(state.earned);
  const unlocked: BadgeId[] = [];

  const check = (id: BadgeId, condition: boolean): void => {
    if (condition && !earned.has(id)) unlocked.push(id);
  };

  check('first_lesson', state.lessonsCompleted >= 1);
  check('first_tp', state.tpCompleted >= 1);
  check('perfect_quiz', state.hasPerfectQuiz);
  check('course_completed', state.coursesCompleted >= 1);
  check('streak_7', state.currentStreak >= 7);
  check('streak_30', state.currentStreak >= 30);

  return unlocked;
}

/* ------------------------------------------------------------------ */
/* 5) Classement par cours                                             */
/* ------------------------------------------------------------------ */

export interface LeaderboardEntryInput {
  studentId: string;
  xp: number;
  /** Nom complet du compte (jamais l'email) — anonymisé si `optOut`. */
  name?: string | null;
  /** L'apprenant a refusé d'apparaître nominativement au classement. */
  optOut?: boolean;
}

export interface LeaderboardRow {
  rank: number;
  studentId: string;
  xp: number;
  /** « Prénom I. », ou « Apprenant » si opt-out / nom vide. */
  displayName: string;
  /** true pour la ligne de l'apprenant qui consulte. */
  isViewer: boolean;
}

/** Libellé public d'un apprenant : prénom + initiale du nom. Jamais l'email. */
export function leaderboardDisplayName(name: string | null | undefined, optOut?: boolean): string {
  if (optOut) return 'Apprenant';
  const parts = (name ?? '')
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0);
  const first = parts[0];
  if (!first) return 'Apprenant';
  const last = parts[1];
  return last ? `${first} ${last[0]!.toUpperCase()}.` : first;
}

/**
 * Classe les entrées d'un cours : XP décroissant, égalité départagée par
 * studentId (déterministe). Rang de compétition : deux ex æquo partagent le
 * rang, le suivant est décalé (1, 2, 2, 4). PURE — l'appelant tronque au top N.
 */
export function rankLeaderboard(
  entries: readonly LeaderboardEntryInput[],
  viewerId?: string,
): LeaderboardRow[] {
  const sorted = [...entries].sort((a, b) => {
    if (b.xp !== a.xp) return b.xp - a.xp;
    return a.studentId.localeCompare(b.studentId);
  });

  const rows: LeaderboardRow[] = [];
  let previousXp: number | null = null;
  let previousRank = 0;

  sorted.forEach((entry, index) => {
    const rank = previousXp !== null && entry.xp === previousXp ? previousRank : index + 1;
    previousXp = entry.xp;
    previousRank = rank;
    rows.push({
      rank,
      studentId: entry.studentId,
      xp: entry.xp,
      displayName: leaderboardDisplayName(entry.name, entry.optOut),
      isViewer: viewerId !== undefined && entry.studentId === viewerId,
    });
  });

  return rows;
}
