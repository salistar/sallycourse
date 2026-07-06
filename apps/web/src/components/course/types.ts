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
}

export interface SectionView {
  id: string;
  title: string;
  order: number;
  lessons: LessonView[];
}

export interface CourseDetailView {
  id: string;
  title: string;
  status: CourseStatus;
  difficulty: Difficulty;
  locale: Locale;
  createdAt: string;
  sections: SectionView[];
}
