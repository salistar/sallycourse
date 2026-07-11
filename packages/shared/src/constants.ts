// Constantes métier — source unique (Prompt 113 : aucun littéral magique ailleurs).
export const UDEMY = {
  TITLE_MAX_CHARS: 60,
  SUBTITLE_MAX_CHARS: 120,
  DESCRIPTION_MIN_WORDS: 200,
  MIN_TOTAL_VIDEO_MINUTES: 30,
  MIN_SECTIONS: 5,
  MIN_LEARNING_OBJECTIVES: 4,
  COURSE_IMAGE: { width: 750, height: 422 },
} as const;

export const AUDIO = {
  TARGET_LUFS: -16,
  BACKGROUND_MUSIC_DB_UNDER_VOICE: -28,
  NARRATION_WORDS_PER_MINUTE: 140,
} as const;

export const VIDEO = {
  WIDTH: 1920,
  HEIGHT: 1080,
  SLIDE_CROSSFADE_SECONDS: 0.4,
  INTRO_SECONDS: 3,
  DRAFT_HEIGHT: 720,
} as const;

/** Avatar vidéo « talking head » (Prompt 82) — segment intro/conclusion de section. */
export const AVATAR = {
  /** Durée cible du segment avatar d'intro/conclusion, en secondes. */
  SEGMENT_SECONDS: 6,
  /** Intervalle de polling du statut de rendu HeyGen. */
  POLL_INTERVAL_MS: 3_000,
  /** Timeout total du polling avant abandon (repli mock). */
  POLL_TIMEOUT_MS: 120_000,
  /** Voix HeyGen par défaut (neutre, multilingue). */
  DEFAULT_VOICE_ID: 'heygen-default-voice',
} as const;

export const THUMBNAILS = {
  YOUTUBE: { width: 1280, height: 720 },
  OG: { width: 1200, height: 630 },
} as const;

export const QUIZ = {
  MIN_QUESTIONS_PER_SECTION: 8,
  MAX_QUESTIONS_PER_SECTION: 12,
  CHOICES_PER_QUESTION: 4,
} as const;

/**
 * Score de qualité pédagogique (Prompt 94) — évaluation Claude (ou heuristique
 * en mode mock) sur 100, ventilée en 4 axes de 0 à 25. Seuil minimum avant
 * déploiement Udemy : contournable par l'utilisateur avec confirmation
 * explicite (jamais un blocage silencieux).
 */
export const QUALITY_SCORE = {
  MIN_DEPLOY_THRESHOLD: 60,
  RUBRIC_MAX_PER_CRITERION: 25,
  MAX_SCORE: 100,
} as const;

export const PLANS = {
  // maxDeployPlatforms : nombre de plateformes cibles autorisées par déploiement.
  // Free est bridé (1 plateforme à la fois) ; pro/business déploient partout (Infinity).
  free: { coursesPerMonth: 1, watermark: true, api: false, multiAccounts: false, maxDeployPlatforms: 1 },
  pro: { coursesPerMonth: 10, watermark: false, api: false, multiAccounts: false, maxDeployPlatforms: Infinity },
  business: { coursesPerMonth: Infinity, watermark: false, api: true, multiAccounts: true, maxDeployPlatforms: Infinity },
} as const;

export type PlanId = keyof typeof PLANS;

// Priorité des files BullMQ par plan (P73) — plus PETIT nombre = traité en
// premier (convention BullMQ). business passe devant pro, lui-même devant free.
export const PLAN_QUEUE_PRIORITY: Record<PlanId, number> = {
  business: 1,
  pro: 5,
  free: 10,
};

/**
 * Priorité BullMQ correspondant au plan d'un utilisateur — à passer dans les
 * JobOptions via `{ priority: priorityForPlan(user.plan) }`. Plan absent/inconnu
 * → retombe sur la priorité 'free' (aucun passe-droit implicite).
 */
export function priorityForPlan(plan: PlanId | string | null | undefined): number {
  if (plan && plan in PLAN_QUEUE_PRIORITY) {
    return PLAN_QUEUE_PRIORITY[plan as PlanId];
  }
  return PLAN_QUEUE_PRIORITY.free;
}

export const LOCALES = ['fr', 'en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];
export const RTL_LOCALES: readonly Locale[] = ['ar'];
