/**
 * Composants du dashboard « mission control » — point d'entrée unique.
 * Câblés au réel (P9) ; les mocks de ./mock-data restent pour les vitrines design.
 */
export { GreetingHeader, type GreetingHeaderProps } from './greeting-header';
export { CourseGrid, type CourseGridProps } from './course-grid';
export { parseCourseFilter, type CourseFilterId } from './course-filter';
export { CourseCard, type CourseCardProps } from './course-card';
export { CourseThumbnail, type CourseThumbnailProps } from './course-thumbnail';
export { ProgressRing, type ProgressRingProps } from './progress-ring';
export { GenerationPanel, type GenerationPanelProps } from './generation-panel';
export { FirstCourseEmpty, type FirstCourseEmptyProps } from './first-course-empty';
export { DashboardSidebar } from './sidebar';
export { NotificationBell } from './notification-bell';
export { GlobalSearch } from './global-search';
export { AssistantPanel } from './assistant-panel';
export {
  MOCK_COURSES,
  MOCK_STATS,
  MOCK_USER,
  MOCK_GENERATION_STEPS,
  MOCK_GENERATION_LOGS,
  MOCK_SLIDE_PREVIEWS,
  PLATFORM_LABELS,
  userInitials,
  type DashboardCourse,
  type DashboardStat,
  type DashboardUser,
  type PlatformId,
  type GenerationLogLine,
  type LogLevel,
  type SlidePreview,
} from './mock-data';
