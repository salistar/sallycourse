// Pont unique vers les packages workspace (@sallycourse/shared, @sallycourse/db).
// Le tsconfig du worker fixe rootDir=src alors que ces packages sont consommés
// en source (.ts) : tsc lève TS6059 au premier point d'import (diagnostic de
// programme, sans impact sur le typage ni l'exécution via tsx). On centralise
// donc les imports cross-package ici, chacun neutralisé par un @ts-ignore ciblé.
// Le reste du worker importe './shared.js' : typage complet, zéro pragma ailleurs.

// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export * from '@sallycourse/shared/queues.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export * from '@sallycourse/shared/lesson-delta.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { getConfig, requireConfig, resetConfigCache, type AppConfig } from '@sallycourse/shared/config.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export * from '@sallycourse/shared/constants.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export * from '@sallycourse/shared/schemas/course.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export * from '@sallycourse/shared/schemas/lesson-content.js';
// prettier-ignore
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { checkUdemyCompliance, type UdemyComplianceInput, type UdemyComplianceReport, type UdemyComplianceLessonInput, type ComplianceIssue, type ComplianceSeverity, type ComplianceIssueCode } from '@sallycourse/shared/udemy-compliance.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export * from '@sallycourse/shared/storage.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { encryptSecret, decryptSecret } from '@sallycourse/shared/crypto.js';
// prettier-ignore
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { encryptCredentials, decryptCredentials, redactCredentials, type PlatformCredentialData } from '@sallycourse/shared/platform-credentials.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { generateCourseImage, marketingFormats, type CourseImageSpecInput } from '@sallycourse/design/marketing-assets.js';
// prettier-ignore
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { annotateScreenshot, zoomInsetMaskSvg, type AnnotationSpecInput, type AnnotatedScreenshot } from '@sallycourse/design/annotations.js';
// prettier-ignore
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { renderTemplate, SlideTemplate as SlideTemplateEnum, SLIDE_TEMPLATE_NAMES, escapeHtml, type SlideTemplateName, type SlideTemplateInput } from '@sallycourse/design/render-templates.js';
// prettier-ignore
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { renderPdfTemplate, PdfTemplate, type PdfTemplateName, type QuizSolutionsPdfInput, type DeploymentReportPdfInput, type ReportPlatform, type ReportChecklistItem, type ReportChecklistTone, type WorkbookPdfInput, type CheatsheetPdfInput, type CheatsheetSection } from '@sallycourse/design/pdf-templates.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { connectDb } from '@sallycourse/db/connect.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { Course, type CourseDocument, type ICourse } from '@sallycourse/db/models/course.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { Section, type ISection } from '@sallycourse/db/models/section.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { User, type IUser } from '@sallycourse/db/models/user.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { Lesson, LESSON_STATUSES, type ILesson, type LessonStatus, type ILessonVersion } from '@sallycourse/db/models/lesson.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { GenerationJob, type IGenerationJob } from '@sallycourse/db/models/generation-job.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { Quiz, type IQuiz, type QuizDocument } from '@sallycourse/db/models/quiz.js';
// prettier-ignore
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { Deployment, DEPLOYMENT_STATUSES, DEPLOYMENT_MODES, type IDeployment, type IDeployedLesson, type DeploymentDocument, type DeploymentStatus, type DeploymentMode } from '@sallycourse/db/models/deployment.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { type ISection } from '@sallycourse/db/models/section.js';
// prettier-ignore
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { PlatformCredential, CREDENTIAL_KINDS, CREDENTIAL_PLATFORMS, type IPlatformCredential, type PlatformCredentialDocument, type CredentialKind, type CredentialPlatform } from '@sallycourse/db/models/platform-credential.js';
// prettier-ignore
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { LmsListing, LMS_CURRENCIES, type ILmsListing, type LmsListingDocument, type LmsCurrency } from '@sallycourse/db/models/lms-listing.js';
// prettier-ignore
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { Enrollment, type IEnrollment, type EnrollmentDocument } from '@sallycourse/db/models/enrollment.js';
// prettier-ignore
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { CostRecord, COST_KINDS, type ICostRecord, type CostRecordDocument, type CostKind } from '@sallycourse/db/models/cost-record.js';
// prettier-ignore
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { CourseAnalytics, type ICourseAnalytics, type CourseAnalyticsDocument } from '@sallycourse/db/models/course-analytics.js';
// prettier-ignore
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { claudeCostUsd, ttsCostUsd, renderCostUsd, imageCostUsd, CLAUDE_PRICING_USD_PER_MTOK, TTS_USD_PER_CHAR, RENDER_USD_PER_SECOND, IMAGE_USD_PER_UNIT } from '@sallycourse/shared/pricing-table.js';
// prettier-ignore
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { notify, type NotifyInput, type NotifyResult } from '@sallycourse/db/notification-service.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { Notification, NOTIFICATION_TYPES, type INotification, type NotificationType } from '@sallycourse/db/models/notification.js';
