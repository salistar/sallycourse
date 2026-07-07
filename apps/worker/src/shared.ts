// Pont unique vers les packages workspace (@sallycourse/shared, @sallycourse/db).
// Le tsconfig du worker fixe rootDir=src alors que ces packages sont consommés
// en source (.ts) : tsc lève TS6059 au premier point d'import (diagnostic de
// programme, sans impact sur le typage ni l'exécution via tsx). On centralise
// donc les imports cross-package ici, chacun neutralisé par un @ts-ignore ciblé.
// Le reste du worker importe './shared.js' : typage complet, zéro pragma ailleurs.

// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export * from '@sallycourse/shared/queues.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { getConfig, requireConfig, resetConfigCache, type AppConfig } from '@sallycourse/shared/config.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export * from '@sallycourse/shared/constants.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export * from '@sallycourse/shared/schemas/course.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export * from '@sallycourse/shared/schemas/lesson-content.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export * from '@sallycourse/shared/storage.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { generateCourseImage, marketingFormats, type CourseImageSpecInput } from '@sallycourse/design/marketing-assets.js';
// prettier-ignore
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { annotateScreenshot, zoomInsetMaskSvg, type AnnotationSpecInput, type AnnotatedScreenshot } from '@sallycourse/design/annotations.js';
// prettier-ignore
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { renderTemplate, SlideTemplate as SlideTemplateEnum, SLIDE_TEMPLATE_NAMES, type SlideTemplateName, type SlideTemplateInput } from '@sallycourse/design/render-templates.js';
// prettier-ignore
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { renderPdfTemplate, PdfTemplate, type PdfTemplateName, type QuizSolutionsPdfInput } from '@sallycourse/design/pdf-templates.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { connectDb } from '@sallycourse/db/connect.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { Course, type CourseDocument, type ICourse } from '@sallycourse/db/models/course.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { Section, type ISection } from '@sallycourse/db/models/section.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { User, type IUser } from '@sallycourse/db/models/user.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { Lesson, LESSON_STATUSES, type ILesson, type LessonStatus } from '@sallycourse/db/models/lesson.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { GenerationJob, type IGenerationJob } from '@sallycourse/db/models/generation-job.js';
// @ts-ignore TS6059 — source hors rootDir (voir en-tête), typage intact
export { Quiz, type IQuiz, type QuizDocument } from '@sallycourse/db/models/quiz.js';
