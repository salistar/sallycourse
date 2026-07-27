import { z } from 'zod';
// @ts-ignore TS2835 — imports sans extension, résolus partout (Bundler/Next/tsx)
import { difficultySchema, lessonTypeSchema, localeSchema, quizQuestionSchema } from './course';

// ── Archive « maître » anti-lock-in (Prompt 182) ────────────────────────────
//
// Une archive ZIP DOCUMENTÉE et RE-IMPORTABLE par cours contenant TOUTES les
// sources : course.json / sections.json / lessons.json (AVEC le champ script) /
// quizzes.json + tous les médias sous media/. Ce module est la SOURCE UNIQUE
// de vérité (schéma zod versionné) partagée par l'export (worker) et le
// re-import (web) : l'un sérialise, l'autre valide et réinsère — jamais de
// format divergent entre les deux moitiés.
//
// Portabilité : aucune référence par ObjectId. Les leçons/quiz sont rattachés à
// leur section/leçon par ORDRE (sectionOrder/lessonOrder), si bien que le
// re-import peut créer des documents entièrement neufs (nouveaux _id) sans
// dépendre des identifiants d'origine.

/** Version du format d'archive. Incrémenter à tout changement de structure non rétrocompatible. */
export const MASTER_ARCHIVE_VERSION = 1 as const;

/** Noms de fichiers JSON dans l'archive — contrat partagé export/import. */
export const MASTER_ARCHIVE_FILENAMES = {
  manifest: 'manifest.json',
  readme: 'README.md',
  course: 'course.json',
  sections: 'sections.json',
  lessons: 'lessons.json',
  quizzes: 'quizzes.json',
} as const;

/** Dossier racine des médias embarqués dans l'archive. */
export const MASTER_ARCHIVE_MEDIA_DIR = 'media' as const;

/**
 * Chemin d'un média DANS l'archive à partir de sa sous-clé (partie de la clé S3
 * après `courses/{id}/`). Inverse de `subKeyFromMediaPath`.
 */
export function mediaArchivePath(subKey: string): string {
  return `${MASTER_ARCHIVE_MEDIA_DIR}/${subKey}`;
}

/** Sous-clé d'un chemin média de l'archive (retire le préfixe `media/`) ; null si non média. */
export function subKeyFromMediaPath(archivePath: string): string | null {
  const prefix = `${MASTER_ARCHIVE_MEDIA_DIR}/`;
  return archivePath.startsWith(prefix) ? archivePath.slice(prefix.length) : null;
}

/**
 * Sous-clé S3 relative au cours : retire le préfixe `courses/{courseId}/`.
 * Retourne null si la clé n'appartient pas à ce cours (ne devrait pas arriver).
 */
export function masterArchiveSubKey(storageKey: string, courseId: string): string | null {
  const prefix = `courses/${courseId}/`;
  return storageKey.startsWith(prefix) ? storageKey.slice(prefix.length) : null;
}

/** Reconstruit la clé S3 d'un média pour un NOUVEAU cours (re-import). */
export function storageKeyForSubKey(courseId: string, subKey: string): string {
  return `courses/${courseId}/${subKey}`;
}

/**
 * Réécrit une clé S3 « course-scoped » d'un export vers le cours ré-importé —
 * fonction PURE, unique source de la réécriture des clés au re-import.
 *
 * SÉCURITÉ anti cross-tenant (Prompt 182) : une archive FORGÉE peut placer une
 * clé d'asset pointant vers les objets S3 d'un tiers — soit un autre cours
 * (`courses/{victimId}/…`), soit des données user-scoped (`voice-samples/{userId}`,
 * `avatar-faces/{userId}`). Comme la page cours de l'importateur PRÉSIGNE ces
 * valeurs, une clé étrangère stockée verbatim laisserait lire l'objet d'autrui.
 * On réécrit donc les clés du propre cours de l'archive (`courses/{oldId}/…` →
 * `courses/{newId}/…`) et on NEUTRALISE (`null`) toute clé pointant vers un autre
 * cours ou vers un préfixe S3 sensible d'un tiers.
 *
 * NB : cette fonction est appliquée RÉCURSIVEMENT à des objets Mixed contenant du
 * texte libre (marketing/ressources). On laisse donc passer inchangé tout ce qui
 * n'est pas une clé S3 reconnue (texte, URL http(s)) — sinon on corromprait les
 * descriptions. Seuls les préfixes de STOCKAGE réels sont filtrés.
 */
const FOREIGN_KEY_PREFIXES = ['voice-samples/', 'avatar-faces/'];

export function rewriteCourseKey(value: string, oldId: string, newId: string): string | null {
  const oldPrefix = `courses/${oldId}/`;
  if (value.startsWith(oldPrefix)) return `courses/${newId}/${value.slice(oldPrefix.length)}`;
  // Clé d'un AUTRE cours, ou préfixe user-scoped d'un tiers → forgée, neutralisée.
  if (value.startsWith('courses/')) return null;
  if (FOREIGN_KEY_PREFIXES.some((p) => value.startsWith(p))) return null;
  return value; // texte libre / URL externe : inchangé (aucune corruption)
}

/** Une sous-clé sûre : pas de traversée de chemin, pas de séparateur absolu. */
const safeSubKeySchema = z
  .string()
  .min(1)
  .refine(
    (v) => !v.startsWith('/') && !v.split('/').some((seg) => seg === '..' || seg === '.'),
    { message: 'sous-clé de média non sûre (traversée de chemin interdite)' },
  );

/** Une entrée de média : sous-clé (relative au cours) + chemin dans l'archive. */
export const masterArchiveMediaEntrySchema = z.object({
  subKey: safeSubKeySchema,
  path: z.string().min(1),
});
export type MasterArchiveMediaEntry = z.infer<typeof masterArchiveMediaEntrySchema>;

/** Métadonnées + inventaire des médias (manifest.json). */
export const masterArchiveManifestSchema = z.object({
  version: z.literal(MASTER_ARCHIVE_VERSION),
  courseId: z.string().min(1),
  exportedAt: z.string().min(1),
  /** Signature de l'outil producteur (informatif). */
  generator: z.string().optional(),
  /** Compteurs de structure (contrôle de cohérence à l'import). */
  structure: z.object({
    sections: z.number().int().nonnegative(),
    lessons: z.number().int().nonnegative(),
    quizzes: z.number().int().nonnegative(),
  }),
  /** Inventaire complet des médias embarqués sous media/. */
  media: z.array(masterArchiveMediaEntrySchema),
});
export type MasterArchiveManifest = z.infer<typeof masterArchiveManifestSchema>;

/**
 * Champs de cours transportés (course.json). Volontairement explicite (pas de
 * passthrough) pour ne JAMAIS embarquer d'identifiants d'instance (userId,
 * workspaceId, credentials…). Les champs Mixed restent `unknown` (préservés
 * tels quels par JSON, réinjectés à l'identique).
 */
export const masterArchiveCourseSchema = z.object({
  title: z.string().min(1),
  difficulty: difficultySchema,
  locale: localeSchema,
  watermark: z.boolean().optional(),
  ttsVoice: z.string().optional(),
  narrationSpeed: z.number().optional(),
  generationMode: z.enum(['auto', 'validated']).optional(),
  llmProvider: z.string().optional(),
  coverImageUrl: z.string().optional(),
  // outline reste du JSON BRUT (comme les autres champs Mixed) : un plan legacy/
  // édité non conforme à outlineSchema ne doit pas faire échouer TOUT le
  // re-import (Prompt 182, anti-lock-in). La validation stricte est refaite à
  // l'import (createCourseFromArchive) qui n'inclut l'outline que s'il est valide.
  outline: z.unknown().optional(),
  marketing: z.unknown().optional(),
  resources: z.unknown().optional(),
  repurposing: z.unknown().optional(),
  qualityScore: z.unknown().optional(),
  improvementSuggestions: z.unknown().optional(),
  advancedParams: z.unknown().optional(),
  aiDisclosureAccepted: z.boolean().optional(),
  backgroundMusicId: z.string().optional(),
  musicVolume: z.number().optional(),
  jingleEnabled: z.boolean().optional(),
  avatarEnabled: z.boolean().optional(),
  avatarId: z.string().optional(),
  useCustomVoice: z.boolean().optional(),
  providerMix: z.unknown().optional(),
});
export type MasterArchiveCourse = z.infer<typeof masterArchiveCourseSchema>;

/** Une section (sections.json) — rattachée par ordre. */
export const masterArchiveSectionSchema = z.object({
  order: z.number().int().nonnegative(),
  title: z.string().min(1),
});
export type MasterArchiveSection = z.infer<typeof masterArchiveSectionSchema>;

/** Une leçon (lessons.json) — AVEC le champ script et les assets (clés S3). */
export const masterArchiveLessonSchema = z.object({
  sectionOrder: z.number().int().nonnegative(),
  order: z.number().int().nonnegative(),
  title: z.string().min(1),
  type: lessonTypeSchema,
  status: z.string().optional(),
  durationMin: z.number().optional(),
  summary: z.string().optional(),
  generatedSummary: z.string().optional(),
  /** Script de génération complet (slides/narration/TP/…) — cœur de l'anti-lock-in. */
  script: z.unknown().optional(),
  /** Assets S3 de la leçon (clés réécrites vers le nouveau cours au re-import). */
  assets: z.unknown().optional(),
  contentHash: z.string().optional(),
});
export type MasterArchiveLesson = z.infer<typeof masterArchiveLessonSchema>;

/** Un quiz (quizzes.json) — rattaché par ordre de section (et de leçon si connu). */
export const masterArchiveQuizSchema = z.object({
  sectionOrder: z.number().int().nonnegative(),
  lessonOrder: z.number().int().nonnegative().nullable().optional(),
  questions: z.array(quizQuestionSchema),
});
export type MasterArchiveQuiz = z.infer<typeof masterArchiveQuizSchema>;

/** L'archive complète (vue logique) — assemblée des 5 fichiers JSON. */
export const masterArchiveSchema = z.object({
  manifest: masterArchiveManifestSchema,
  course: masterArchiveCourseSchema,
  sections: z.array(masterArchiveSectionSchema),
  lessons: z.array(masterArchiveLessonSchema),
  quizzes: z.array(masterArchiveQuizSchema),
});
export type MasterArchive = z.infer<typeof masterArchiveSchema>;

/**
 * Sérialise l'archive logique en fichiers JSON (manifest/course/sections/
 * lessons/quizzes). PURE : ne produit pas les médias ni le README (spécifiques
 * au producteur). Source unique côté export.
 */
export function serializeMasterArchiveFiles(archive: MasterArchive): Record<string, string> {
  const F = MASTER_ARCHIVE_FILENAMES;
  return {
    [F.manifest]: JSON.stringify(archive.manifest, null, 2),
    [F.course]: JSON.stringify(archive.course, null, 2),
    [F.sections]: JSON.stringify(archive.sections, null, 2),
    [F.lessons]: JSON.stringify(archive.lessons, null, 2),
    [F.quizzes]: JSON.stringify(archive.quizzes, null, 2),
  };
}

/** Erreur de re-import : archive malformée (fichier manquant/JSON invalide/schéma). */
export class MasterArchiveParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MasterArchiveParseError';
  }
}

/**
 * Lit et VALIDE l'archive à partir d'un accès aux fichiers texte (fonction
 * `read(name)` retournant le contenu UTF-8 ou undefined). Source unique côté
 * import : jette une MasterArchiveParseError explicite si un fichier manque, si
 * un JSON est invalide, ou si le schéma zod échoue.
 */
export function parseMasterArchiveFiles(read: (name: string) => string | undefined): MasterArchive {
  const F = MASTER_ARCHIVE_FILENAMES;

  const readJson = (name: string): unknown => {
    const raw = read(name);
    if (raw === undefined) {
      throw new MasterArchiveParseError(`fichier manquant dans l'archive : ${name}`);
    }
    try {
      return JSON.parse(raw);
    } catch {
      throw new MasterArchiveParseError(`JSON invalide : ${name}`);
    }
  };

  const candidate = {
    manifest: readJson(F.manifest),
    course: readJson(F.course),
    sections: readJson(F.sections),
    lessons: readJson(F.lessons),
    quizzes: readJson(F.quizzes),
  };

  const parsed = masterArchiveSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new MasterArchiveParseError(
      `archive invalide : ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join(' ; ')}`,
    );
  }
  return parsed.data;
}
