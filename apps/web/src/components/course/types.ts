import type { CourseStatus, Difficulty, LessonType, Locale } from '@sallycourse/shared';

// Réexports pratiques pour les composants du dossier.
export type { CourseStatus, Difficulty, LessonType, Locale };

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
}
