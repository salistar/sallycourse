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
// prettier-ignore
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { dripPlanInputSchema, dripCadenceSchema, dripEntryInputSchema, parseCadence, isCompleted, isEntryComplete, itemsDue, computeNextRunAt, planEntryRun, buildScheduleEntries, cadenceLabel, DRIP_CADENCE_KINDS, DRIP_LIMITS, type DripCadence, type DripEntryInput, type DripPlanInput, type DripEntryState, type ParsedCadence, type EntryRunPlan } from '@sallycourse/shared/deploy-schedule.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export * from '@sallycourse/shared/video-preview.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { getConfig, requireConfig, resetConfigCache, type AppConfig } from '@sallycourse/shared/config.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export * from '@sallycourse/shared/constants.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export * from '@sallycourse/shared/schemas/course.js';
// prettier-ignore
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { dictationBriefSchema, dictationSystemPrompt, dictationUserPrompt, mockBriefFromTranscript, whisperLangForDictation, toCreateCourseInput, assistantActionSchema, assistantActionRequiresConfirmation, type DictationBrief, type DictationInputLang, type AssistantAction } from '@sallycourse/shared/voice-intent.js';
// @ts-ignore TS2835 — consommé en source par le worker (NodeNext)
export { renderGenerationDirectives, normalizeContentRatio, type GenerationPhase } from '@sallycourse/shared/generation-params.js';
// @ts-ignore TS2835 — consommé en source par le worker (NodeNext)
export { renderPlatformConstraints, activePlatformConstraints, PLATFORM_CONSTRAINTS } from '@sallycourse/shared/platform-constraints.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export * from '@sallycourse/shared/schemas/lesson-content.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export * from '@sallycourse/shared/schemas/master-archive.js';
// prettier-ignore
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { screencastOverlaySchema, screencastOverlaysSchema, screencastRenderInputSchema, SCREENCAST_OVERLAY_POSITIONS, MAX_SCREENCAST_OVERLAY_TEXT, MAX_SCREENCAST_OVERLAYS, MAX_SCREENCAST_NARRATION, type ScreencastOverlay, type ScreencastOverlayInput, type ScreencastOverlayPosition, type ScreencastRenderInput } from '@sallycourse/shared/schemas/screencast.js';
// prettier-ignore
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { checkUdemyCompliance, type UdemyComplianceInput, type UdemyComplianceReport, type UdemyComplianceLessonInput, type ComplianceIssue, type ComplianceSeverity, type ComplianceIssueCode } from '@sallycourse/shared/udemy-compliance.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export * from '@sallycourse/shared/storage.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { WATERMARK_DEFAULTS, buildWatermarkDrawtextFilter, buildWatermarkFfmpegArgs, escapeDrawtext, type WatermarkAnchor } from '@sallycourse/shared/watermark.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { ViewingSession, type IViewingSession, type ViewingSessionDocument } from '@sallycourse/db/models/viewing-session.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { encryptSecret, decryptSecret } from '@sallycourse/shared/crypto.js';
// prettier-ignore
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { encryptCredentials, decryptCredentials, redactCredentials, type PlatformCredentialData } from '@sallycourse/shared/platform-credentials.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { generateCourseImage, marketingFormats, type CourseImageSpecInput } from '@sallycourse/design/marketing-assets.js';
// prettier-ignore
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { annotateScreenshot, zoomInsetMaskSvg, buildAltTextPrompt, altTextRequestSchema, altTextResultSchema, type AnnotationSpecInput, type AnnotatedScreenshot, type AltTextRequest, type AltTextResult } from '@sallycourse/design/annotations.js';
// prettier-ignore
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { renderTemplate, SlideTemplate as SlideTemplateEnum, SLIDE_TEMPLATE_NAMES, escapeHtml, type SlideTemplateName, type SlideTemplateInput } from '@sallycourse/design/render-templates.js';
// prettier-ignore
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { renderPdfTemplate, PdfTemplate, type PdfTemplateName, type QuizSolutionsPdfInput, type DeploymentReportPdfInput, type ReportPlatform, type ReportChecklistItem, type ReportChecklistTone, type WorkbookPdfInput, type CheatsheetPdfInput, type CheatsheetSection, type LinkedinPitchPdfInput } from '@sallycourse/design/pdf-templates.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { connectDb } from '@sallycourse/db/connect.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { colors } from '@sallycourse/design/tokens.js';
// prettier-ignore
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { Course, type CourseDocument, type ICourse, type IDubbedVersion } from '@sallycourse/db/models/course.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { Section, type ISection } from '@sallycourse/db/models/section.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { User, type IUser } from '@sallycourse/db/models/user.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
// prettier-ignore
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext) ; typage intact ici (Bundler)
export { Lesson, LESSON_STATUSES, SCREENCAST_RENDER_STATUSES, type ILesson, type LessonStatus, type ScreencastRenderStatus, type ILessonVersion, type ILessonSimilarityWarning, type ISandboxLinks, type ISandboxProjectLinks } from '@sallycourse/db/models/lesson.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { GenerationJob, type IGenerationJob } from '@sallycourse/db/models/generation-job.js';
// prettier-ignore
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext) ; typage intact ici (Bundler)
export { VoiceDictation, VOICE_DICTATION_STATUSES, type IVoiceDictation, type VoiceDictationDocument, type VoiceDictationStatus, type VoiceDictationInputLang } from '@sallycourse/db/models/voice-dictation.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { Quiz, type IQuiz, type QuizDocument } from '@sallycourse/db/models/quiz.js';
// prettier-ignore
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { Deployment, DEPLOYMENT_STATUSES, DEPLOYMENT_MODES, type IDeployment, type IDeployedLesson, type DeploymentDocument, type DeploymentStatus, type DeploymentMode } from '@sallycourse/db/models/deployment.js';
// prettier-ignore
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext) ; typage intact ici (Bundler)
export { DeploymentSchedule, DEPLOYMENT_SCHEDULE_STATUSES, type IDeploymentSchedule, type IDeploymentScheduleEntry, type IDripCadence, type DeploymentScheduleDocument, type DeploymentScheduleStatus } from '@sallycourse/db/models/deployment-schedule.js';
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
export { LandingVariant, type ILandingVariant, type LandingVariantDocument } from '@sallycourse/db/models/landing-variant.js';
// prettier-ignore
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { claudeCostUsd, ttsCostUsd, ttsCostUsdForProvider, renderCostUsd, imageCostUsd, transcribeCostUsd, avatarCostUsd, CLAUDE_PRICING_USD_PER_MTOK, CLOUD_LLM_PRICING_USD_PER_MTOK, TTS_USD_PER_CHAR, TTS_MODAL_USD_PER_CHAR, FREE_TTS_PROVIDERS, RENDER_USD_PER_SECOND, IMAGE_USD_PER_UNIT, TRANSCRIBE_USD_PER_AUDIO_SECOND, AVATAR_USD_PER_VIDEO_SECOND, computeOssCost, recommendProviderMix, ossLlmCostUsd, ossTtsCostUsd, ossRenderCostUsd, ossImageCostUsd, DEFAULT_PROVIDER_MIX, HETZNER_USD_PER_HOUR, RARE_LOCALES, type ProviderMix, type OssCourseCost } from '@sallycourse/shared/pricing-table.js';
// prettier-ignore
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { notify, type NotifyInput, type NotifyResult } from '@sallycourse/db/notification-service.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { Notification, NOTIFICATION_TYPES, type INotification, type NotificationType } from '@sallycourse/db/models/notification.js';
// prettier-ignore
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { chunkText, selectContextChunks, buildSourceMaterialContext, detectSourceMaterialKind, sourceMaterialFilesSchema, sourceMaterialFileSchema, CHUNK_SIZE_CHARS, CHUNK_OVERLAP_CHARS, MAX_CONTEXT_CHUNKS, type SourceMaterialKind, type SourceMaterialFile } from '@sallycourse/shared/rag.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { PromptTemplate, type IPromptTemplate, type PromptTemplateDocument } from '@sallycourse/db/models/prompt-template.js';
// prettier-ignore
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext) ; typage intact ici (Bundler)
export { ShortClip, SHORT_CLIP_PLATFORMS, SHORT_CLIP_STATUSES, type IShortClip, type ShortClipDocument, type ShortClipPlatform, type ShortClipStatus } from '@sallycourse/db/models/short-clip.js';
// prettier-ignore
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext) ; typage intact ici (Bundler)
export { MUSIC_CATALOG, MUSIC_MIX, JINGLE_TRACK_ID, JINGLE_TRACK, musicStorageKey, findMusicTrack, selectTrackByMood, type MusicTrack, type MusicMood } from '@sallycourse/shared/music-catalog.js';
// prettier-ignore
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext) ; typage intact ici (Bundler)
export { VOICE_CATALOG, VOICE_CATALOG_IDS, getCatalogVoice, resolveCatalogVoice, type CatalogVoice } from '@sallycourse/shared/voice-catalog.js';
// prettier-ignore
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext) ; typage intact ici (Bundler)
export { THEME_CATALOG, THEME_CATALOG_IDS, DEFAULT_THEME_ID, themeById, articleVars, type SlideTheme } from '@sallycourse/shared/theme-catalog.js';
// prettier-ignore
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext) ; typage intact ici (Bundler)
export { AVATAR_CATALOG, AVATAR_CATALOG_IDS, getCatalogAvatar, avatarCatalogPhotoKey, type CatalogAvatar } from '@sallycourse/shared/avatar-catalog.js';
// prettier-ignore
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext) ; typage intact ici (Bundler)
export { EmailSequence, EmailSequenceEnrollment, EMAIL_SEQUENCE_KINDS, EMAIL_SEQUENCE_ENROLLMENT_STATUSES, type IEmailSequence, type IEmailSequenceStep, type EmailSequenceDocument, type EmailSequenceKind, type IEmailSequenceEnrollment, type EmailSequenceEnrollmentDocument, type EmailSequenceEnrollmentStatus } from '@sallycourse/db/models/email-sequence.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { sendEmail } from '@sallycourse/db/email/send.js';
// prettier-ignore
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext) ; typage intact ici (Bundler)
export { Workspace, WORKSPACE_ROLES, type IWorkspace, type IWorkspaceMember, type WorkspaceDocument, type WorkspaceRole } from '@sallycourse/db/models/workspace.js';
// prettier-ignore
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext) ; typage intact ici (Bundler)
export { LessonComment, type ILessonComment, type LessonCommentDocument } from '@sallycourse/db/models/lesson-comment.js';
// prettier-ignore
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { checkApprovalGate, canPerform, roleInWorkspace, type WorkspaceAction, type WorkspaceLike, type WorkspaceMemberLike, type ApprovalGateCourseLike, type ApprovalGateResult } from '@sallycourse/shared/workspace-roles.js';
// prettier-ignore
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { generateCouponCode, generateUniqueCouponCode, isValidCouponCodeShape, checkCouponValidity, applyDiscount, resolveGenericPromoPeriods, type PromoPeriodSuggestion, type CouponLike } from '@sallycourse/shared/coupon.js';
// prettier-ignore
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext) ; typage intact ici (Bundler)
export { Coupon, COUPON_PLATFORMS, type ICoupon, type CouponDocument, type CouponPlatform } from '@sallycourse/db/models/coupon.js';
// prettier-ignore
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext) ; typage intact ici (Bundler)
export { CourseMarketplaceListing, MARKETPLACE_LICENSE_TYPES, MARKETPLACE_LISTING_STATUSES, type ICourseMarketplaceListing, type CourseMarketplaceListingDocument, type MarketplaceLicenseType, type MarketplaceListingStatus } from '@sallycourse/db/models/course-marketplace-listing.js';
// prettier-ignore
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext) ; typage intact ici (Bundler)
export { CourseMarketplacePurchase, type ICourseMarketplacePurchase, type CourseMarketplacePurchaseDocument } from '@sallycourse/db/models/marketplace-purchase.js';
// prettier-ignore
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext) ; typage intact ici (Bundler)
export { computeRevenueShare, isValidListingShape, marketplacePriceLabel, DEFAULT_MARKETPLACE_FEE_RATE, type RevenueShareResult, type MarketplaceLicenseTypeLike } from '@sallycourse/shared/marketplace.js';
// prettier-ignore
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext) ; typage intact ici (Bundler)
export { AgencyClient, type IAgencyClient, type AgencyClientDocument } from '@sallycourse/db/models/agency-client.js';
// prettier-ignore
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { resolveAgencyDeployCredentials, isCredentialAllowedForAgencyCourse, aggregateAgencyBilling, type AgencyClientLike, type AgencyCourseLike, type AgencyContextResult, type AgencyCostRow, type AgencyClientBillingReport } from '@sallycourse/shared/agency.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { AuditLog, type IAuditLog, type AuditAction } from '@sallycourse/db/models/audit-log.js';
// prettier-ignore
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { AUDIT_RETENTION_DAYS, computeAuditRetentionCutoff, selectAuditLogsToPurge, type AuditLogRetentionEntry } from '@sallycourse/shared/audit.js';
// prettier-ignore
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext) ; typage intact ici (Bundler)
export { GamificationProfile, CourseXp, type IGamificationProfile, type GamificationProfileDocument, type IEarnedBadge, type ICourseXp, type CourseXpDocument } from '@sallycourse/db/models/gamification.js';
// prettier-ignore
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext) ; typage intact ici (Bundler)
export { PushSubscription, type IPushSubscription, type PushSubscriptionDocument } from '@sallycourse/db/models/push-subscription.js';
// prettier-ignore
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext) ; typage intact ici (Bundler)
export { sendWebPush, signVapidJwt, encryptPayload, vapidPublicKeyToUint8Array, type PushSubscriptionKeys, type WebPushPayload, type SendWebPushResult } from '@sallycourse/shared/web-push.js';
// prettier-ignore
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext) ; typage intact ici (Bundler)
export { XP_RULES, BADGES, BADGE_IDS, dayKeyUtc, shiftDayKeyUtc, updateStreak, isStreakAtRisk, evaluateBadges, findBadge, levelForXp, xpForLevel, xpToNextLevel, xpForQuiz, xpForLessonCompletion, xpForLessonEvent, rankLeaderboard, leaderboardDisplayName, type BadgeId, type BadgeDefinition, type BadgeState, type StreakState, type StreakUpdate, type LevelProgress, type LeaderboardRow, type LeaderboardEntryInput } from '@sallycourse/shared/gamification.js';
// prettier-ignore
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext) ; typage intact ici (Bundler)
export { BLOG, SEARCH_INTENTS, BLOG_POST_STATUSES, blogPlanSchema, blogPlanEntrySchema, blogPostContentSchema, blogSlugify, uniqueBlogSlug, computeBlogSchedule, blogPostStatusFor, selectDueBlogPosts, computeInternalLinks, renderInternalLinksSection, renderCourseCta, assembleBlogMarkdown, countBlogWords, countKeywordOccurrences, validateBlogSeo, type BlogPlan, type BlogPlanEntry, type BlogPostContent, type BlogPostStatus, type SearchIntent, type BlogLinkTarget } from '@sallycourse/shared/blog.js';
// prettier-ignore
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext) ; typage intact ici (Bundler)
export { BlogPost, type IBlogPost, type BlogPostDocument, type IBlogFaqEntry } from '@sallycourse/db/models/blog-post.js';
