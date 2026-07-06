import { z } from 'zod';
import type { LessonType } from '@sallycourse/shared';

/**
 * Contrat du payload de validation du plan (éditeur → API approve-outline).
 * Défini ici (et non via le baril @sallycourse/shared) car ce fichier est
 * aussi importé côté client : le baril tire node:crypto / aws-sdk.
 */

/** Types de leçon éditables — alignés sur lessonTypeSchema (vérifié par `satisfies`). */
export const LESSON_TYPE_VALUES = ['video', 'article', 'tp', 'quiz'] as const satisfies readonly LessonType[];

export const outlineLessonPayloadSchema = z.object({
  title: z.string().trim().min(1, 'Titre de leçon requis.').max(200),
  type: z.enum(LESSON_TYPE_VALUES),
  durationMin: z.number().positive().max(600),
  summary: z.string().max(4000).optional(),
});

export const outlineSectionPayloadSchema = z.object({
  title: z.string().trim().min(1, 'Titre de section requis.').max(200),
  lessons: z.array(outlineLessonPayloadSchema).min(1, 'Chaque section doit contenir au moins une leçon.'),
});

export const approveOutlinePayloadSchema = z.object({
  sections: z
    .array(outlineSectionPayloadSchema)
    .min(1, 'Le plan doit contenir au moins une section.')
    .max(50),
});

export type ApproveOutlinePayload = z.infer<typeof approveOutlinePayloadSchema>;

export const regenerateOutlinePayloadSchema = z.object({
  /** Consignes supplémentaires transmises au worker outline. */
  extraInstructions: z.string().trim().max(2000).optional(),
});

export type RegenerateOutlinePayload = z.infer<typeof regenerateOutlinePayloadSchema>;
