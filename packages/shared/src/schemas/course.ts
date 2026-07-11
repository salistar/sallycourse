import { z } from 'zod';
// @ts-ignore TS2835 — import sans extension, consommé en source par le worker (NodeNext)
import { LOCALES } from '../constants';

// Source de vérité unique des entités (Prompt 114) — les types TS et la
// validation API dérivent de ces schémas ; les modèles Mongoose les suivent.

export const difficultySchema = z.enum(['beginner', 'intermediate', 'advanced']);
export type Difficulty = z.infer<typeof difficultySchema>;

export const courseStatusSchema = z.enum([
  'draft',
  'generating',
  'outline-review',
  'ready',
  'published',
  'failed',
  // Annulation propre demandée par l'utilisateur en cours de génération (P73).
  'cancelled',
]);
export type CourseStatus = z.infer<typeof courseStatusSchema>;

export const lessonTypeSchema = z.enum(['video', 'article', 'tp', 'quiz']);
export type LessonType = z.infer<typeof lessonTypeSchema>;

export const localeSchema = z.enum(LOCALES);

export const outlineLessonSchema = z.object({
  title: z.string().min(1),
  type: lessonTypeSchema,
  durationMin: z.number().positive(),
  summary: z.string(),
});

export const outlineSectionSchema = z.object({
  title: z.string().min(1),
  lessons: z.array(outlineLessonSchema).min(1),
});

export const outlineSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string(),
  description: z.string(),
  learningObjectives: z.array(z.string()).min(4).max(8),
  prerequisites: z.array(z.string()),
  targetAudience: z.array(z.string()),
  sections: z.array(outlineSectionSchema).min(1),
});
export type Outline = z.infer<typeof outlineSchema>;

export const quizQuestionSchema = z.object({
  question: z.string().min(1),
  choices: z.array(z.string()).length(4),
  correctIndex: z.number().int().min(0).max(3),
  explanation: z.string(),
  difficulty: difficultySchema.default('beginner'),
});
export type QuizQuestion = z.infer<typeof quizQuestionSchema>;

export const createCourseInputSchema = z.object({
  title: z.string().min(3).max(120),
  difficulty: difficultySchema,
  locale: localeSchema.default('fr'),
  ttsVoice: z.string().optional(),
  targetPlatforms: z.array(z.string()).default([]),
  approxSections: z.number().int().min(3).max(30).optional(),
  /**
   * Avatar vidéo (P82, bêta) — additif. Optionnel côté type (comme ttsVoice/
   * approxSections) pour ne pas casser les appelants existants de
   * createCourseForUser qui ne le renseignent pas encore ; createCourseForUser
   * traite absent/false de façon identique (comportement inchangé par défaut).
   */
  avatarEnabled: z.boolean().optional(),
  /** Avatar HeyGen choisi — ignoré si avatarEnabled=false. */
  avatarId: z.string().optional(),
  /**
   * Programmer la génération en heures creuses (P134) — si vrai, le premier
   * job (outline) est enfilé avec un délai BullMQ jusqu'à la prochaine
   * fenêtre creuse (2h-6h, voir off-peak-window.ts) au lieu de démarrer
   * immédiatement. Optionnel, défaut false (comportement inchangé).
   */
  scheduleOffPeak: z.boolean().optional(),
});
export type CreateCourseInput = z.infer<typeof createCourseInputSchema>;
