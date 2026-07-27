// LMS interne — expérience apprenant (Prompt 43) + gamification (Prompt 200).
export { LearnCourseExperience, type LearnCourseExperienceProps } from './learn-course-experience';
export { LearnQuizPlayer, type LearnQuizPlayerProps } from './learn-quiz-player';
export { CourseChatbotWidget, type CourseChatbotWidgetProps } from './course-chatbot-widget';
export { GamificationHud, type GamificationHudProps } from './gamification-hud';
export { CourseLeaderboard, type CourseLeaderboardProps } from './course-leaderboard';
export { StreakReminderOptIn } from './streak-reminder-optin';
// Avis RÉEL de l'apprenant inscrit (Prompt 205) — source unique des avis publics.
export { CourseReviewForm, type CourseReviewFormProps } from './course-review-form';
export type {
  LearnCourseView,
  LearnLessonView,
  LearnSectionView,
  LearnQuizQuestionView,
  GamificationAwardView,
  GamificationBadgeView,
  GamificationLevelProgressView,
  GamificationProfileView,
  LeaderboardRowView,
} from './types';
