import { z } from 'zod';
import { difficultySchema, localeSchema } from '@sallycourse/shared';

/**
 * Schémas Zod de l'API publique v1 (Prompt 51). Source unique pour la
 * validation des routes ET la génération de la doc OpenAPI (route openapi).
 * Volontairement plus restreint/stable que le schéma interne de création :
 * l'API publique expose titre + niveau + plateformes.
 */

/** POST /api/v1/courses — création d'un cours. */
export const v1CreateCourseSchema = z.object({
  title: z.string().min(3).max(120),
  difficulty: difficultySchema.default('beginner'),
  locale: localeSchema.default('fr'),
  platforms: z.array(z.string()).max(9).default([]),
});
export type V1CreateCourseInput = z.infer<typeof v1CreateCourseSchema>;

/** POST /api/v1/courses/[id]/deploy — déploiement multi-plateformes. */
export const v1DeploySchema = z.object({
  platforms: z.array(z.string()).min(1).max(9),
  mode: z.enum(['auto', 'assisted', 'manual']).default('auto'),
});
export type V1DeployInput = z.infer<typeof v1DeploySchema>;
