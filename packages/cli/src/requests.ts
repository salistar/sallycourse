import { z } from 'zod';

// Construction et validation PURE des corps de requête envoyés à l'API v1.
// Aucune I/O ici : les commandes appellent ces helpers puis passent le résultat
// au client HTTP. Les enums miroir des schémas serveur (@sallycourse/shared) —
// le CLI est autonome (pas d'import cross-package), on redéclare le minimum.

/** Niveaux de difficulté acceptés par l'API (miroir de difficultySchema). */
export const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** Langues acceptées (miroir de LOCALES). */
export const LOCALES = ['fr', 'en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];

/** Corps POST /api/v1/courses (miroir de createCourseInputSchema). */
export interface CreateCourseBody {
  title: string;
  difficulty: Difficulty;
  locale: Locale;
  targetPlatforms: string[];
  approxSections?: number;
}

const createCourseSchema = z.object({
  title: z.string().min(3, 'titre trop court (min 3)').max(120, 'titre trop long (max 120)'),
  difficulty: z.enum(DIFFICULTIES),
  locale: z.enum(LOCALES).default('fr'),
  targetPlatforms: z.array(z.string()).default([]),
  approxSections: z.number().int().min(3).max(30).optional(),
});

export interface CreateCourseInput {
  title: string;
  level?: string;
  lang?: string;
  deploy?: string[];
  sections?: number;
}

/**
 * Valide/normalise les entrées d'un `create` en corps d'API. Jette avec un
 * message lisible si un champ est invalide (niveau/langue inconnus, titre hors
 * bornes). `--deploy` alimente targetPlatforms (déploiement à la génération).
 */
export function buildCreateCourseBody(input: CreateCourseInput): CreateCourseBody {
  const parsed = createCourseSchema.safeParse({
    title: input.title,
    difficulty: input.level ?? 'beginner',
    locale: input.lang ?? 'fr',
    targetPlatforms: input.deploy ?? [],
    approxSections: input.sections,
  });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || 'champ'}: ${i.message}`)
      .join(' ; ');
    throw new Error(`Entrées invalides : ${issues}`);
  }
  const data = parsed.data;
  const body: CreateCourseBody = {
    title: data.title,
    difficulty: data.difficulty,
    locale: data.locale,
    targetPlatforms: data.targetPlatforms,
  };
  if (data.approxSections !== undefined) body.approxSections = data.approxSections;
  return body;
}

/** Modes de déploiement acceptés. */
export const DEPLOY_MODES = ['auto', 'assisted', 'manual'] as const;
export type DeployMode = (typeof DEPLOY_MODES)[number];

/** Corps POST /api/v1/courses/:id/deploy (miroir de deploySchema). */
export interface DeployBody {
  platforms: string[];
  mode: DeployMode;
}

const deploySchema = z.object({
  platforms: z.array(z.string()).min(1, 'au moins une plateforme').max(9, 'trop de plateformes'),
  mode: z.enum(DEPLOY_MODES).default('auto'),
});

/** Valide/normalise un corps de déploiement (déduplique les plateformes). */
export function buildDeployBody(platforms: string[], mode?: string): DeployBody {
  const unique = [...new Set(platforms.map((p) => p.trim()).filter(Boolean))];
  const parsed = deploySchema.safeParse({ platforms: unique, mode: mode ?? 'auto' });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => i.message).join(' ; ');
    throw new Error(`Déploiement invalide : ${issues}`);
  }
  return { platforms: parsed.data.platforms, mode: parsed.data.mode };
}

/** Une ligne de batch : un titre + surcharges optionnelles par ligne. */
export interface BatchEntry {
  title: string;
  level?: string;
  lang?: string;
  deploy?: string[];
  sections?: number;
}

/**
 * Parse un fichier batch. Format simple, une entrée par ligne non vide :
 *   Titre du cours | key=val | key=val
 * Le premier segment est le titre ; les segments suivants (séparés par `|`)
 * portent des surcharges `level=`, `lang=`, `deploy=a,b`, `sections=`. Les lignes
 * vides et celles commençant par `#` sont ignorées. Logique pure (texte → objets).
 */
export function parseBatchFile(content: string): BatchEntry[] {
  const entries: BatchEntry[] = [];
  const lines = content.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const segments = line.split('|').map((s) => s.trim());
    const title = segments[0] ?? '';
    if (!title) continue;

    const entry: BatchEntry = { title };
    for (const seg of segments.slice(1)) {
      const eq = seg.indexOf('=');
      if (eq === -1) continue;
      const key = seg.slice(0, eq).trim().toLowerCase();
      const value = seg.slice(eq + 1).trim();
      if (!value) continue;
      switch (key) {
        case 'level':
          entry.level = value;
          break;
        case 'lang':
          entry.lang = value;
          break;
        case 'deploy':
          entry.deploy = value
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          break;
        case 'sections': {
          const n = Number.parseInt(value, 10);
          if (Number.isFinite(n)) entry.sections = n;
          break;
        }
        default:
          break;
      }
    }
    entries.push(entry);
  }
  return entries;
}
