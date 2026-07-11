import type { CourseStatus, Difficulty, LessonType, Locale, VideoQualityStatus } from '@sallycourse/shared';

// Réexports pratiques pour les composants du dossier.
export type { CourseStatus, Difficulty, LessonType, Locale, VideoQualityStatus };

// DTO sérialisables (page serveur → composants clients) de la page détail.
// Les URLs d'assets sont déjà PRÉSIGNÉES côté serveur.

export type LessonStatus = 'pending' | 'generating' | 'ready' | 'failed';

export interface LessonAssetsView {
  /** URL présignée de la vidéo (si rendue). */
  videoUrl?: string;
  /** URL présignée de la piste de sous-titres WebVTT. */
  vttUrl?: string;
  /** Contenu Markdown de l'article (stocké en base). */
  articleMd?: string;
  /** URLs présignées des captures d'écran. */
  screenshots: string[];
}

export interface QuizQuestionView {
  question: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
}

/** Slide éditable d'un script vidéo (sous-ensemble édité + champs préservés). */
export interface SlideView {
  template: string;
  title: string;
  bullets: string[];
  narration: string;
  /** Champs de la slide non exposés à l'édition, conservés à l'identique. */
  rest: Record<string, unknown>;
}

export interface LessonView {
  id: string;
  title: string;
  type: LessonType;
  status: LessonStatus;
  order: number;
  durationMin?: number;
  summary?: string;
  assets: LessonAssetsView;
  /** Questions du quiz associé (null si aucun quiz généré). */
  quiz: QuizQuestionView[] | null;
  /** Slides du script vidéo (leçons 'video' avec script produit). */
  scriptSlides?: SlideView[];
  /**
   * Cycle brouillon→final de l'aperçu vidéo rapide (Prompt 133) — pertinent
   * uniquement pour les leçons 'video'. Absent/'none' = jamais utilisé.
   */
  videoQualityStatus?: VideoQualityStatus;
}

export interface SectionView {
  id: string;
  title: string;
  order: number;
  lessons: LessonView[];
}

/** Un contrôle unitaire du rapport qualité (Prompt 26). */
export interface QaCheckView {
  code: string;
  ok: boolean;
  detail: string;
}

/** Rapport de contrôle qualité automatique d'un cours (null si jamais exécuté). */
export interface QaReportView {
  passed: boolean;
  ranAt: string;
  checks: QaCheckView[];
}

/** Rubrique détaillée du score de qualité pédagogique (Prompt 94), 0-25 chacun. */
export interface QualityRubricView {
  clarity: number;
  progression: number;
  examples: number;
  engagement: number;
}

/** Score de qualité pédagogique d'un cours (null si jamais évalué). */
export interface QualityScoreView {
  score: number;
  rubric: QualityRubricView;
  feedback: string[];
  evaluatedAt: string;
}

/** Un thème récurrent extrait des avis étudiants (P62). */
export interface ReviewThemeView {
  label: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  count: number;
  quotes: string[];
}

/** Une suggestion d'amélioration ciblée (P62). */
export interface ImprovementSuggestionView {
  /** Titre de la leçon visée, ou null si la suggestion porte sur le cours entier. */
  lessonRef: string | null;
  /** Identifiant de la leçon résolu depuis lessonRef (null si non résolu / global). */
  lessonId: string | null;
  action: string;
  rationale: string;
}

/** Analyse des retours étudiants persistée sur un cours (null si jamais exécutée). */
export interface ReviewFeedbackView {
  themes: ReviewThemeView[];
  suggestions: ImprovementSuggestionView[];
  reviewCount: number;
  averageRating: number;
  generatedAt: string;
}

/** Une entrée du glossaire du cours (P65). */
export interface GlossaryEntryView {
  term: string;
  definition: string;
}

/** Une ressource « pour aller plus loin » (P65). */
export interface FurtherResourceView {
  title: string;
  kind: string;
  url?: string;
  description: string;
}

/**
 * Ressources téléchargeables enrichies (P65) — cheat sheet + workbook PDF
 * (URLs présignées) et contenu structuré (glossaire, ressources). Null tant
 * qu'aucune génération n'a tourné.
 */
export interface CourseResourcesView {
  glossary: GlossaryEntryView[];
  furtherResources: FurtherResourceView[];
  cheatsheetUrl?: string;
  workbookUrl?: string;
  generatedAt: string;
}

/** Une version doublée du cours dans une langue cible (Prompt 92). */
export interface DubbedVersionView {
  locale: Locale;
  status: 'pending' | 'generating' | 'ready' | 'failed';
  lessonsWithSubtitles: number;
  lessonsWithVideo: number;
  updatedAt: string;
}

export interface CourseDetailView {
  id: string;
  title: string;
  status: CourseStatus;
  difficulty: Difficulty;
  locale: Locale;
  createdAt: string;
  sections: SectionView[];
  /** Rapport QA (Prompt 26) — null tant que le contrôle n'a pas tourné. */
  qaReport?: QaReportView | null;
  /** Score de qualité pédagogique (Prompt 94) — null tant qu'aucune évaluation n'a tourné. */
  qualityScore?: QualityScoreView | null;
  /** Analyse des retours étudiants (P62) — null tant qu'aucune analyse n'a tourné. */
  feedback?: ReviewFeedbackView | null;
  /** Ressources téléchargeables enrichies (P65) — null tant qu'aucune génération n'a tourné. */
  resources?: CourseResourcesView | null;
  /** Versions doublées existantes (P92) — tableau vide tant qu'aucune traduction n'a tourné. */
  dubbedVersions?: DubbedVersionView[];
}
