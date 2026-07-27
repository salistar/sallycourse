import type { CourseStatus, Difficulty } from '@sallycourse/shared';

/**
 * Données MOCK typées du dashboard — le câblage réel (API) arrive au Prompt 9.
 * Les types dérivent de @sallycourse/shared pour que la substitution soit
 * transparente : seule la provenance des données changera.
 */

/* ------------------------------------------------------------------ */
/* Plateformes de publication                                          */
/* ------------------------------------------------------------------ */

export type PlatformId = 'udemy' | 'youtube' | 'site';

export const PLATFORM_LABELS: Record<PlatformId, string> = {
  udemy: 'Udemy',
  youtube: 'YouTube',
  site: 'Site web',
};

/* ------------------------------------------------------------------ */
/* Cours affichés dans la grille                                       */
/* ------------------------------------------------------------------ */

export interface DashboardCourse {
  id: string;
  title: string;
  status: CourseStatus;
  difficulty: Difficulty;
  /** Avancement de la génération (0–100). 100 pour un cours terminé. */
  progress: number;
  sectionsCount: number;
  lessonsCount: number;
  /** Durée vidéo cumulée, en minutes. */
  durationMin: number;
  platforms: PlatformId[];
  /** Libellé de fraîcheur pré-formaté (évite tout calcul de date côté mock). */
  updatedAtLabel: string;
  /** Cours archivé par la rétention P79 (médias purgés) — réactivable. */
  archived?: boolean;
  /**
   * URL présignée de la couverture réelle du cours (hero SDXL/Z-Image ou image
   * uploadée par l'auteur). Absente → repli sur la miniature géométrique
   * générée (CourseThumbnail). Ajouté 2026-07-26 (les covers générées n'étaient
   * jamais affichées sur les cartes du dashboard).
   */
  coverUrl?: string;
}

export const MOCK_COURSES: DashboardCourse[] = [
  {
    id: 'crs_docker',
    title: 'Docker & Kubernetes : des conteneurs à la production',
    status: 'generating',
    difficulty: 'intermediate',
    progress: 62,
    sectionsCount: 9,
    lessonsCount: 47,
    durationMin: 312,
    platforms: ['udemy'],
    updatedAtLabel: 'en cours — étape 4/6',
  },
  {
    id: 'crs_python',
    title: 'Python pour la data : NumPy, Pandas et visualisation',
    status: 'ready',
    difficulty: 'beginner',
    progress: 100,
    sectionsCount: 11,
    lessonsCount: 58,
    durationMin: 418,
    platforms: ['udemy', 'youtube'],
    updatedAtLabel: 'généré hier',
  },
  {
    id: 'crs_nextjs',
    title: 'Next.js 15 en profondeur : App Router, RSC et déploiement',
    status: 'published',
    difficulty: 'advanced',
    progress: 100,
    sectionsCount: 12,
    lessonsCount: 64,
    durationMin: 486,
    platforms: ['udemy', 'youtube', 'site'],
    updatedAtLabel: 'publié il y a 3 jours',
  },
  {
    id: 'crs_sql',
    title: 'SQL de zéro : requêtes, modélisation et optimisation',
    status: 'outline-review',
    difficulty: 'beginner',
    progress: 18,
    sectionsCount: 8,
    lessonsCount: 0,
    durationMin: 0,
    platforms: ['udemy'],
    updatedAtLabel: 'plan à valider',
  },
  {
    id: 'crs_figma',
    title: 'Figma avancé : design systems et prototypage',
    status: 'draft',
    difficulty: 'intermediate',
    progress: 0,
    sectionsCount: 0,
    lessonsCount: 0,
    durationMin: 0,
    platforms: [],
    updatedAtLabel: 'brouillon créé il y a 1 semaine',
  },
  {
    id: 'crs_rust',
    title: 'Rust pour développeurs TypeScript',
    status: 'failed',
    difficulty: 'advanced',
    progress: 34,
    sectionsCount: 10,
    lessonsCount: 12,
    durationMin: 74,
    platforms: ['youtube'],
    updatedAtLabel: 'échec à l’étape narration',
  },
];

/* ------------------------------------------------------------------ */
/* Statistiques clés (compteurs animés du header)                      */
/* ------------------------------------------------------------------ */

export interface DashboardStat {
  id: string;
  label: string;
  value: number;
  suffix?: string;
  /** Variation récente affichée sous le compteur (ex. « +2 ce mois »). */
  trend?: string;
}

export const MOCK_STATS: DashboardStat[] = [
  { id: 'courses', label: 'Cours créés', value: 6, trend: '+2 ce mois-ci' },
  { id: 'lessons', label: 'Leçons générées', value: 181, trend: '+47 cette semaine' },
  { id: 'video', label: 'Heures de vidéo', value: 21.5, suffix: ' h', trend: '≈ 1 290 min rendues' },
  { id: 'quiz', label: 'Questions de quiz', value: 428, trend: '48 quiz assemblés' },
];

/* ------------------------------------------------------------------ */
/* Génération en direct : étapes, journal et aperçus de slides         */
/* ------------------------------------------------------------------ */

/** Étapes du pipeline, alignées sur GenerationTimeline (motion D4). */
export const MOCK_GENERATION_STEPS = [
  { id: 'analyze', label: 'Analyse du sujet', description: 'Recherche et cadrage pédagogique' },
  { id: 'outline', label: 'Plan du cours', description: 'Sections, leçons et objectifs' },
  { id: 'write', label: 'Rédaction des leçons', description: 'Scripts, articles et TPs' },
  { id: 'narrate', label: 'Narration audio', description: 'Voix de synthèse et mixage' },
  { id: 'render', label: 'Rendu des vidéos', description: 'Slides animées 1080p' },
  { id: 'quiz', label: 'Quiz & export', description: 'Questions, corrigés et paquets' },
] as const;

export type LogLevel = 'info' | 'step' | 'success' | 'warn';

export interface GenerationLogLine {
  /** Horodatage figé (mock) — chaîne pour un rendu SSR stable. */
  time: string;
  level: LogLevel;
  text: string;
  /** Index de l'étape (0-based) à laquelle la ligne appartient. */
  stepIndex: number;
}

export const MOCK_GENERATION_LOGS: GenerationLogLine[] = [
  { time: '14:02:11', level: 'step', text: '▸ Étape 1/6 — Analyse du sujet', stepIndex: 0 },
  { time: '14:02:12', level: 'info', text: 'Sujet : « Docker & Kubernetes » — niveau intermédiaire (fr)', stepIndex: 0 },
  { time: '14:02:19', level: 'info', text: '32 sources pédagogiques croisées, 6 angles retenus', stepIndex: 0 },
  { time: '14:02:24', level: 'success', text: '✓ Cadrage validé — public : devs backend & ops', stepIndex: 0 },
  { time: '14:02:25', level: 'step', text: '▸ Étape 2/6 — Plan du cours', stepIndex: 1 },
  { time: '14:02:38', level: 'info', text: '9 sections, 47 leçons, 6 objectifs d’apprentissage', stepIndex: 1 },
  { time: '14:02:41', level: 'warn', text: '⚠ Section 7 trop dense — redécoupée en 2 leçons', stepIndex: 1 },
  { time: '14:02:44', level: 'success', text: '✓ Plan conforme aux exigences Udemy (min. 5 sections)', stepIndex: 1 },
  { time: '14:02:45', level: 'step', text: '▸ Étape 3/6 — Rédaction des leçons', stepIndex: 2 },
  { time: '14:03:02', level: 'info', text: 'Leçon 12/47 : « Volumes et persistance » — 1 480 mots', stepIndex: 2 },
  { time: '14:03:18', level: 'info', text: 'TP 3 : docker-compose multi-services + corrigé', stepIndex: 2 },
  { time: '14:03:31', level: 'success', text: '✓ 47/47 scripts rédigés — ton : pragmatique, exemples réels', stepIndex: 2 },
  { time: '14:03:32', level: 'step', text: '▸ Étape 4/6 — Narration audio', stepIndex: 3 },
  { time: '14:03:47', level: 'info', text: 'Voix « Camille » (fr-FR), 140 mots/min, normalisation −16 LUFS', stepIndex: 3 },
  { time: '14:04:05', level: 'info', text: 'Piste 29/47 mixée — musique de fond à −28 dB', stepIndex: 3 },
  { time: '14:04:21', level: 'success', text: '✓ 5 h 12 de narration prêtes', stepIndex: 3 },
  { time: '14:04:22', level: 'step', text: '▸ Étape 5/6 — Rendu des vidéos', stepIndex: 4 },
  { time: '14:04:40', level: 'info', text: 'Rendu 1920×1080 — fondu entre slides 0,4 s', stepIndex: 4 },
  { time: '14:05:02', level: 'info', text: 'Vidéo 18/47 encodée (H.264, 6,2 Mo/min)', stepIndex: 4 },
  { time: '14:05:19', level: 'success', text: '✓ Rendu terminé — 47 vidéos, 5 h 12 au total', stepIndex: 4 },
  { time: '14:05:20', level: 'step', text: '▸ Étape 6/6 — Quiz & export', stepIndex: 5 },
  { time: '14:05:33', level: 'info', text: '86 questions générées (8–12 par section), 4 choix chacune', stepIndex: 5 },
  { time: '14:05:41', level: 'success', text: '✓ Paquet Udemy prêt — miniature 750×422 incluse', stepIndex: 5 },
];

export interface SlidePreview {
  /** L'aperçu s'affiche dès que cette étape est atteinte. */
  stepIndex: number;
  kicker: string;
  title: string;
  bullets: string[];
  slideNumber: string;
}

export const MOCK_SLIDE_PREVIEWS: SlidePreview[] = [
  {
    stepIndex: 0,
    kicker: 'Analyse',
    title: 'À qui s’adresse ce cours ?',
    bullets: ['Développeurs backend', 'Ops & SRE débutants', 'Curieux du cloud natif'],
    slideNumber: 'Cadrage',
  },
  {
    stepIndex: 1,
    kicker: 'Section 1 · Leçon 1',
    title: 'Pourquoi conteneuriser ?',
    bullets: ['« Ça marche sur ma machine »', 'Isolation & reproductibilité', 'Du dev à la prod sans friction'],
    slideNumber: 'Slide 1 / 214',
  },
  {
    stepIndex: 2,
    kicker: 'Section 3 · Leçon 12',
    title: 'Volumes et persistance',
    bullets: ['Volumes nommés vs bind mounts', 'Cycle de vie des données', 'Sauvegarde et restauration'],
    slideNumber: 'Slide 54 / 214',
  },
  {
    stepIndex: 3,
    kicker: 'Section 5 · Leçon 29',
    title: 'Déployer sur Kubernetes',
    bullets: ['Pods, Deployments, Services', 'kubectl apply en confiance', 'Rolling updates sans coupure'],
    slideNumber: 'Slide 131 / 214',
  },
  {
    stepIndex: 4,
    kicker: 'Section 7 · Leçon 38',
    title: 'Observabilité en production',
    bullets: ['Logs centralisés', 'Métriques et alerting', 'Debugging d’un pod en CrashLoop'],
    slideNumber: 'Slide 172 / 214',
  },
  {
    stepIndex: 5,
    kicker: 'Quiz final',
    title: 'Validez vos acquis',
    bullets: ['86 questions corrigées', '8 à 12 par section', 'Explications détaillées'],
    slideNumber: 'Slide 214 / 214',
  },
];

/* ------------------------------------------------------------------ */
/* Utilisateur courant (mock)                                          */
/* ------------------------------------------------------------------ */

export interface DashboardUser {
  name: string;
  email: string;
  plan: 'free' | 'pro' | 'business';
}

export const MOCK_USER: DashboardUser = {
  name: 'Sally Andaloussi',
  email: 'sally@salistar.com',
  plan: 'pro',
};

/** Initiales pour l'avatar (ex. « Sally Andaloussi » → « SA »). */
export function userInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
