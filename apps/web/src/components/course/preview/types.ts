import type { LessonType, Locale } from '@sallycourse/shared';

/**
 * DTO sérialisables de la prévisualisation étudiante (Prompt 60), passés du
 * Server Component au client. Les URLs vidéo/sous-titres sont déjà présignées
 * et le Markdown des articles déjà résolu — le client n'a aucune I/O à faire.
 */

export interface PreviewQuizQuestion {
  question: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
}

export interface PreviewLesson {
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
  quiz: PreviewQuizQuestion[];
}

export interface PreviewSection {
  id: string;
  title: string;
  order: number;
}

export interface PreviewCourse {
  id: string;
  title: string;
  summary: string;
  locale: Locale;
  sections: PreviewSection[];
  /** Leçons déjà triées par (ordre de section, ordre de leçon). */
  lessons: PreviewLesson[];
}
