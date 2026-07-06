/**
 * Composants de la page détail d'un cours —
 * `import { CourseDetail } from '@/components/course'`.
 */
export { CourseDetail, type CourseDetailProps } from './course-detail';
export { LessonTree, LESSON_STATUS_BADGE, type LessonTreeProps } from './lesson-tree';
export { LessonPanel, type LessonPanelProps } from './lesson-panel';
export { ArticleView, type ArticleViewProps } from './article-view';
export { ScreenshotGallery, type ScreenshotGalleryProps } from './screenshot-gallery';
export { QuizPreview, type QuizPreviewProps } from './quiz-preview';
export { RegenerateButton, type RegenerateButtonProps } from './regenerate-button';
export { ProgressBanner, type ProgressBannerProps } from './progress-banner';
export type {
  CourseDetailView,
  SectionView,
  LessonView,
  LessonAssetsView,
  LessonStatus,
  QuizQuestionView,
} from './types';
