/**
 * Composants de la page détail d'un cours —
 * `import { CourseDetail } from '@/components/course'`.
 */
export { CourseDetail, type CourseDetailProps } from './course-detail';
export { LessonTree, LESSON_STATUS_BADGE, type LessonTreeProps } from './lesson-tree';
export { LessonPanel, type LessonPanelProps } from './lesson-panel';
export { ArticleView, type ArticleViewProps } from './article-view';
export { TpView, type TpViewProps } from './tp-view';
export { ScreenshotGallery, type ScreenshotGalleryProps } from './screenshot-gallery';
export { QuizPreview, type QuizPreviewProps } from './quiz-preview';
export { RegenerateButton, type RegenerateButtonProps } from './regenerate-button';
export { RecaptureScreenshotsButton, type RecaptureScreenshotsButtonProps } from './recapture-screenshots-button';
export { DeriveButton, type DeriveButtonProps } from './derive-button';
export { ProgressBanner, type ProgressBannerProps } from './progress-banner';
export { DownloadPackButton, type DownloadPackButtonProps } from './download-pack-button';
export { DownloadPortableButton, type DownloadPortableButtonProps } from './download-portable-button';
export { DownloadReportButton, type DownloadReportButtonProps } from './download-report-button';
export { IntroVideoUpload, type IntroVideoUploadProps } from './intro-video-upload';
export { ScreencastPanel, type ScreencastPanelProps } from './screencast-panel';
export { DeployPanel, type DeployPanelProps } from './deploy-panel';
export { QaReportPanel, type QaReportPanelProps } from './qa-report-panel';
export { QualityScorePanel, type QualityScorePanelProps } from './quality-score-panel';
export { FeedbackPanel, type FeedbackPanelProps } from './feedback-panel';
export { ResourcesPanel, type ResourcesPanelProps } from './resources-panel';
export { BlogPanel, type BlogPanelProps } from './blog-panel';
export { DmcaKitPanel, type DmcaKitPanelProps } from './dmca-kit-panel';
export { TranslatePanel, type TranslatePanelProps } from './translate-panel';
export { QuickPreviewPanel, type QuickPreviewPanelProps } from './quick-preview-panel';
export { ApprovePreviewButton, type ApprovePreviewButtonProps } from './approve-preview-button';
export {
  ArticleEditor,
  VideoScriptEditor,
  QuizEditor,
  TpEditor,
  type ArticleEditorProps,
  type VideoScriptEditorProps,
  type QuizEditorProps,
  type TpEditorProps,
} from './edit';
export type {
  CourseDetailView,
  SectionView,
  LessonView,
  LessonAssetsView,
  LessonStatus,
  QuizQuestionView,
  SlideView,
  TpStepView,
  TpContentView,
  QaReportView,
  QaCheckView,
  QualityScoreView,
  QualityRubricView,
  ReviewThemeView,
  ImprovementSuggestionView,
  ReviewFeedbackView,
  GlossaryEntryView,
  FurtherResourceView,
  CourseResourcesView,
  RepurposingView,
  MarketingKitView,
  BlogPostView,
  CourseBlogView,
  DubbedVersionView,
  VideoQualityStatus,
} from './types';
