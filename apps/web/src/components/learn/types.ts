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
