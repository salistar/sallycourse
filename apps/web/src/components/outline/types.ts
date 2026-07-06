import type { Difficulty, LessonType, Locale } from '@sallycourse/shared';

// Réexports pratiques pour les composants du dossier.
export type { Difficulty, LessonType, Locale };

// ── DTO serveur → client (page détail en statut 'outline-review') ──

export interface OutlineLessonDto {
  id: string;
  title: string;
  type: LessonType;
  durationMin?: number;
  summary?: string;
}

export interface OutlineSectionDto {
  id: string;
  title: string;
  lessons: OutlineLessonDto[];
}

export interface OutlineReviewCourse {
  id: string;
  title: string;
  difficulty: Difficulty;
  locale: Locale;
  createdAt: string;
  sections: OutlineSectionDto[];
}

// ── État éditable de l'éditeur drag-and-drop ──────────────────────
// `key` = identifiant dnd-kit stable : _id Mongo pour les éléments existants,
// clé synthétique pour les ajouts (déterministe côté SSR : pas d'UUID).

export interface EditorLesson {
  key: string;
  title: string;
  type: LessonType;
  durationMin: number;
  summary?: string;
}

export interface EditorSection {
  key: string;
  title: string;
  lessons: EditorLesson[];
}

/** Convertit le DTO serveur en état éditable (clés = ids Mongo existants). */
export function toEditorSections(sections: OutlineSectionDto[]): EditorSection[] {
  return sections.map((section) => ({
    key: section.id,
    title: section.title,
    lessons: section.lessons.map((lesson) => ({
      key: lesson.id,
      title: lesson.title,
      type: lesson.type,
      durationMin: lesson.durationMin ?? 5,
      summary: lesson.summary,
    })),
  }));
}
