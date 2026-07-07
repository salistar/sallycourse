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
export { DeriveButton, type DeriveButtonProps } from './derive-button';
export { ProgressBanner, type ProgressBannerProps } from './progress-banner';
export { DownloadPackButton, type DownloadPackButtonProps } from './download-pack-button';
export { DownloadReportButton, type DownloadReportButtonProps } from './download-report-button';
export { IntroVideoUpload, type IntroVideoUploadProps } from './intro-video-upload';
export { DeployPanel, type DeployPanelProps } from './deploy-panel';
export { QaReportPanel, type QaReportPanelProps } from './qa-report-panel';
export { FeedbackPanel, type FeedbackPanelProps } from './feedback-panel';
export { ResourcesPanel, type ResourcesPanelProps } from './resources-panel';
export {
  ArticleEditor,
  VideoScriptEditor,
  QuizEditor,
  type ArticleEditorProps,
  type VideoScriptEditorProps,
  type QuizEditorProps,
} from './edit';
export type {
  CourseDetailView,
  SectionView,
  LessonView,
  LessonAssetsView,
  LessonStatus,
  QuizQuestionView,
  SlideView,
  QaReportView,
  QaCheckView,
  ReviewThemeView,
  ImprovementSuggestionView,
  ReviewFeedbackView,
  GlossaryEntryView,
  FurtherResourceView,
  CourseResourcesView,
} from './types';
