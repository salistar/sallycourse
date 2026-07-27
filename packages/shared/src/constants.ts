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

/**
 * Marge de planification (audit ESG 2026-07-19, E1) : la narration TTS réelle
 * parle en moyenne ~10 % plus vite que l'estimation `durationMin` du plan (mots
 * ÷ AUDIO.NARRATION_WORDS_PER_MINUTE), si bien qu'un plan qui vise pile
 * `MIN_TOTAL_VIDEO_MINUTES` produit régulièrement une vidéo finale SOUS le
 * plancher (mesuré : plan ~32 min → rendu 28,7 min, -10 %). On demande donc à
 * l'IA de planifier une cible plus haute que le plancher réel, qui reste lui
 * strictement inchangé (`checkTotalVideoMinutes` continue de comparer au
 * plancher `MIN_TOTAL_VIDEO_MINUTES`, mesuré sur la vidéo rendue).
 */
export const OUTLINE_PLANNING_DURATION_MARGIN = 1.18;
export const OUTLINE_PLANNING_TARGET_MINUTES = Math.ceil(
  UDEMY.MIN_TOTAL_VIDEO_MINUTES * OUTLINE_PLANNING_DURATION_MARGIN,
);

export const AUDIO = {
  TARGET_LUFS: -16,
  BACKGROUND_MUSIC_DB_UNDER_VOICE: -28,
  NARRATION_WORDS_PER_MINUTE: 140,
  /**
   * Fréquence d'échantillonnage de TOUS les flux audio du pipeline (Hz). 48 kHz
   * est le standard vidéo (YouTube/Udemy/broadcast), contre 44,1 kHz pour le CD.
   * Doit être uniforme : concaténer un silence 44,1 k avec une narration 48 k
   * force de toute façon un rééchantillonnage — autant tout produire en 48 k.
   */
  SAMPLE_RATE: 48000,
} as const;

export const VIDEO = {
  WIDTH: 1920,
  HEIGHT: 1080,
  /** Fréquence d'images de TOUTES les sorties vidéo (leçons, avatar, trailer). */
  FPS: 30,
  SLIDE_CROSSFADE_SECONDS: 0.4,
  INTRO_SECONDS: 3,
  DRAFT_HEIGHT: 720,
} as const;

/**
 * Paramètres de génération des ILLUSTRATIONS de slides (SDXL/Z-Image) —
 * centralisés par l'audit dédup 2026-07-26 (auparavant {896, 896, 25}
 * recopiés dans slide-renderer, slide-image et course-review).
 */
export const SLIDE_IMAGE = {
  WIDTH: 896,
  HEIGHT: 896,
  STEPS: 25,
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
  /** Score minimum (%) pour marquer un quiz SCORM/Common Cartridge comme réussi. */
  PASSING_SCORE_PERCENT: 70,
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

/**
 * Attente de fin de traitement vidéo côté plateforme après upload (Prompts
 * 33-36 Udemy, 105 Kajabi) — même comportement observé sur les deux back-offices
 * pilotés par Playwright : polling jusqu'à disparition du spinner de traitement.
 */
export const VIDEO_PROCESSING = {
  TIMEOUT_MS: 20 * 60 * 1_000,
  POLL_INTERVAL_MS: 10 * 1_000,
} as const;

/**
 * Prix par défaut appliqués quand le cours n'a pas de prix explicite, un par
 * plateforme (devise native propre à chaque marketplace — Prompt 113 :
 * centralisés ici plutôt que dispersés dans chaque adapter).
 */
export const DEFAULT_MARKETPLACE_PRICE = {
  gumroadCents: 4900,
  hotmartBrl: 197,
  thinkific: 49,
} as const;

export const LOCALES = ['fr', 'en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * Déduplication de contenu généré (Prompt 115) : seuil de similarité (Jaccard
 * sur n-grams de mots, 0-1) au-delà duquel deux leçons/cours sont considérés
 * comme quasi-doublons. Alerte uniquement — ne bloque jamais la génération.
 */
export const CONTENT_SIMILARITY = {
  WARNING_THRESHOLD: 0.92,
  NGRAM_SIZE: 3,
} as const;
export const RTL_LOCALES: readonly Locale[] = ['ar'];

/**
 * Anti-double-clic création de cours (Prompt 120) : fenêtre pendant laquelle un
 * second POST /api/courses du même utilisateur avec un titre IDENTIQUE (trim +
 * casse insensible) est traité comme un doublon de soumission (renvoie le cours
 * déjà créé au lieu d'en recréer un et de consommer un second crédit de quota).
 * Distinct de CONTENT_SIMILARITY (fuzzy, informatif) : ici comparaison exacte,
 * fenêtre courte, strictement anti-doublon de clic.
 */
export const COURSE_CREATE_DEDUPE_WINDOW_SEC = 10;
