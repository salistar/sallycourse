/**
 * Éditeurs de contenu par leçon (mode édition de la page cours).
 * `import { ArticleEditor } from '@/components/course/edit'`.
 */
export { ArticleEditor, type ArticleEditorProps } from './article-editor';
export { VideoScriptEditor, type VideoScriptEditorProps } from './video-script-editor';
export { QuizEditor, type QuizEditorProps } from './quiz-editor';
export { useDirtyState, confirmDiscardIfDirty } from './use-dirty-state';
export type { EditableSlide, EditableQuizQuestion } from './types';
