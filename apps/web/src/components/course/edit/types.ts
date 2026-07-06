import type { QuizQuestionView } from '../types';

/**
 * Slide éditable côté client — sous-ensemble modifiable de Slide
 * (@sallycourse/shared) ; les champs non exposés (code, language, notes)
 * sont préservés tels quels dans `rest` et réinjectés à la sauvegarde.
 */
export interface EditableSlide {
  template: string;
  title: string;
  bullets: string[];
  narration: string;
  /** Champs de la slide non édités dans l'UI, conservés à l'identique. */
  rest: Record<string, unknown>;
}

/** Question de quiz éditable (identique à la vue, réutilisée par l'éditeur). */
export type EditableQuizQuestion = QuizQuestionView;
