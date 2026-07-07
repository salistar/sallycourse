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

export const THUMBNAILS = {
  YOUTUBE: { width: 1280, height: 720 },
  OG: { width: 1200, height: 630 },
} as const;

export const QUIZ = {
  MIN_QUESTIONS_PER_SECTION: 8,
  MAX_QUESTIONS_PER_SECTION: 12,
  CHOICES_PER_QUESTION: 4,
} as const;

export const PLANS = {
  // maxDeployPlatforms : nombre de plateformes cibles autorisées par déploiement.
  // Free est bridé (1 plateforme à la fois) ; pro/business déploient partout (Infinity).
  free: { coursesPerMonth: 1, watermark: true, api: false, multiAccounts: false, maxDeployPlatforms: 1 },
  pro: { coursesPerMonth: 10, watermark: false, api: false, multiAccounts: false, maxDeployPlatforms: Infinity },
  business: { coursesPerMonth: Infinity, watermark: false, api: true, multiAccounts: true, maxDeployPlatforms: Infinity },
} as const;

export type PlanId = keyof typeof PLANS;

export const LOCALES = ['fr', 'en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];
export const RTL_LOCALES: readonly Locale[] = ['ar'];
