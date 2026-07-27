// Helpers PURS de l'archive « maître » anti-lock-in (Prompt 182).
// Construisent la vue logique MasterArchive (course/sections/lessons AVEC
// script/quizzes) à partir des documents Mongo, le manifeste et le README.md
// documenté. Isolés du processor pour être testés sans stockage ni base :
// le schéma zod versionné (source unique) vit dans
// @sallycourse/shared/schemas/master-archive, la sérialisation JSON portable
// aussi (serializeMasterArchiveFiles) — ici on ne fait que le MAPPING
// Mongo → vue logique + la documentation lisible.
//
// À NE PAS CONFONDRE : media/portable-export.ts (P142) produit un mini-site
// offline (but différent) ; media/manual-guide.ts (P176) le pack manuel.

import {
  MASTER_ARCHIVE_FILENAMES,
  MASTER_ARCHIVE_MEDIA_DIR,
  MASTER_ARCHIVE_VERSION,
  type ILesson,
  type Locale,
  type MasterArchive,
  type MasterArchiveCourse,
  type MasterArchiveLesson,
  type MasterArchiveManifest,
  type MasterArchiveMediaEntry,
  type MasterArchiveQuiz,
  type MasterArchiveSection,
  type QuizQuestion,
} from '../shared.js';

/** Nom du fichier ZIP de l'archive maître dans le bucket (sous …/exports). */
export const MASTER_ARCHIVE_FILENAME = 'course-master-archive.zip';

/* ------------------------------------------------------------------ */
/* Vues Mongo minimales (structurelles) requises par les builders      */
/* ------------------------------------------------------------------ */

export interface MasterArchiveCourseDoc {
  _id: { toString(): string };
  title: string;
  difficulty: MasterArchiveCourse['difficulty'];
  locale: Locale;
  watermark?: boolean;
  ttsVoice?: string;
  narrationSpeed?: number;
  generationMode?: 'auto' | 'validated';
  llmProvider?: string;
  coverImageUrl?: string;
  outline?: unknown;
  marketing?: unknown;
  resources?: unknown;
  repurposing?: unknown;
  qualityScore?: unknown;
  improvementSuggestions?: unknown;
  advancedParams?: unknown;
  aiDisclosureAccepted?: boolean;
  backgroundMusicId?: string;
  musicVolume?: number;
  jingleEnabled?: boolean;
  avatarEnabled?: boolean;
  avatarId?: string;
  useCustomVoice?: boolean;
  providerMix?: unknown;
}

export interface MasterArchiveSectionDoc {
  _id: { toString(): string };
  order: number;
  title: string;
}

export interface MasterArchiveQuizDoc {
  sectionId: { toString(): string };
  lessonId?: { toString(): string } | null;
  questions: QuizQuestion[];
}

/* ------------------------------------------------------------------ */
/* Builders Mongo → vue logique (purs)                                 */
/* ------------------------------------------------------------------ */

/** N'inclut une propriété que si elle est définie (garde course.json compact). */
function defined<T>(value: T | undefined | null): value is T {
  return value !== undefined && value !== null;
}

/** Extrait les champs de cours transportables (jamais d'identifiant d'instance). */
export function buildMasterArchiveCourse(course: MasterArchiveCourseDoc): MasterArchiveCourse {
  const out: MasterArchiveCourse = {
    title: course.title,
    difficulty: course.difficulty,
    locale: course.locale,
  };
  if (defined(course.watermark)) out.watermark = course.watermark;
  if (defined(course.ttsVoice)) out.ttsVoice = course.ttsVoice;
  if (defined(course.narrationSpeed)) out.narrationSpeed = course.narrationSpeed;
  if (defined(course.generationMode)) out.generationMode = course.generationMode;
  if (defined(course.llmProvider)) out.llmProvider = course.llmProvider;
  if (defined(course.coverImageUrl)) out.coverImageUrl = course.coverImageUrl;
  if (defined(course.outline)) out.outline = course.outline as MasterArchiveCourse['outline'];
  if (defined(course.marketing)) out.marketing = course.marketing;
  if (defined(course.resources)) out.resources = course.resources;
  if (defined(course.repurposing)) out.repurposing = course.repurposing;
  if (defined(course.qualityScore)) out.qualityScore = course.qualityScore;
  if (defined(course.improvementSuggestions)) out.improvementSuggestions = course.improvementSuggestions;
  if (defined(course.advancedParams)) out.advancedParams = course.advancedParams;
  if (defined(course.aiDisclosureAccepted)) out.aiDisclosureAccepted = course.aiDisclosureAccepted;
  if (defined(course.backgroundMusicId)) out.backgroundMusicId = course.backgroundMusicId;
  if (defined(course.musicVolume)) out.musicVolume = course.musicVolume;
  if (defined(course.jingleEnabled)) out.jingleEnabled = course.jingleEnabled;
  if (defined(course.avatarEnabled)) out.avatarEnabled = course.avatarEnabled;
  if (defined(course.avatarId)) out.avatarId = course.avatarId;
  if (defined(course.useCustomVoice)) out.useCustomVoice = course.useCustomVoice;
  if (defined(course.providerMix)) out.providerMix = course.providerMix;
  return out;
}

export function buildMasterArchiveSections(
  sections: readonly MasterArchiveSectionDoc[],
): MasterArchiveSection[] {
  return sections
    .map((s) => ({ order: s.order, title: s.title }))
    .sort((a, b) => a.order - b.order);
}

/**
 * Mappe les leçons vers la vue logique (AVEC script + assets), rattachées par
 * ORDRE de section (pas d'ObjectId). `sectionOrderById` : id de section → ordre.
 */
export function buildMasterArchiveLessons(
  lessons: readonly ILesson[],
  sectionOrderById: ReadonlyMap<string, number>,
): MasterArchiveLesson[] {
  const out: MasterArchiveLesson[] = [];
  for (const lesson of lessons) {
    const sectionOrder = sectionOrderById.get(lesson.sectionId.toString());
    if (sectionOrder === undefined) continue; // section orpheline : ignorée
    const entry: MasterArchiveLesson = {
      sectionOrder,
      order: lesson.order,
      title: lesson.title,
      type: lesson.type,
    };
    if (defined(lesson.status)) entry.status = lesson.status;
    if (defined(lesson.durationMin)) entry.durationMin = lesson.durationMin;
    if (defined(lesson.summary)) entry.summary = lesson.summary;
    if (defined(lesson.generatedSummary)) entry.generatedSummary = lesson.generatedSummary;
    if (lesson.script !== undefined) entry.script = lesson.script;
    if (defined(lesson.assets)) entry.assets = lesson.assets;
    if (defined(lesson.contentHash)) entry.contentHash = lesson.contentHash;
    out.push(entry);
  }
  // Number() : robuste au type inféré via le double re-export du worker (le
  // schéma zod partagé peut être vu `unknown` selon la résolution NodeNext).
  return out.sort(
    (a, b) => Number(a.sectionOrder) - Number(b.sectionOrder) || Number(a.order) - Number(b.order),
  );
}

/** Mappe les quiz vers la vue logique, rattachés par ordre de section (+ leçon si connue). */
export function buildMasterArchiveQuizzes(
  quizzes: readonly MasterArchiveQuizDoc[],
  sectionOrderById: ReadonlyMap<string, number>,
  lessonOrderById: ReadonlyMap<string, number>,
): MasterArchiveQuiz[] {
  const out: MasterArchiveQuiz[] = [];
  for (const quiz of quizzes) {
    const sectionOrder = sectionOrderById.get(quiz.sectionId.toString());
    if (sectionOrder === undefined) continue;
    const lessonOrder = quiz.lessonId ? lessonOrderById.get(quiz.lessonId.toString()) : undefined;
    out.push({
      sectionOrder,
      lessonOrder: lessonOrder ?? null,
      questions: quiz.questions,
    });
  }
  return out.sort((a, b) => a.sectionOrder - b.sectionOrder);
}

/** Assemble le manifeste (version + inventaire médias + compteurs de structure). */
export function buildMasterArchiveManifest(input: {
  courseId: string;
  exportedAt: string;
  sections: readonly MasterArchiveSection[];
  lessons: readonly MasterArchiveLesson[];
  quizzes: readonly MasterArchiveQuiz[];
  media: readonly MasterArchiveMediaEntry[];
}): MasterArchiveManifest {
  return {
    version: MASTER_ARCHIVE_VERSION,
    courseId: input.courseId,
    exportedAt: input.exportedAt,
    generator: 'SallyCourse master-archive',
    structure: {
      sections: input.sections.length,
      lessons: input.lessons.length,
      quizzes: input.quizzes.length,
    },
    media: [...input.media],
  };
}

/* ------------------------------------------------------------------ */
/* README.md documenté                                                 */
/* ------------------------------------------------------------------ */

/**
 * Documentation lisible de l'archive : contenu, format et procédure de
 * RE-IMPORT (dans SallyCourse ou ailleurs). C'est ce qui fait de cette archive
 * un vrai garde-fou anti-lock-in : tout est expliqué, rien n'est propriétaire.
 */
export function masterArchiveReadme(archive: MasterArchive): string {
  const { manifest, course } = archive;
  const F = MASTER_ARCHIVE_FILENAMES;

  return [
    `# Archive maître — ${course.title}`,
    '',
    'Cette archive contient **toutes les sources** de votre cours SallyCourse,',
    'dans un format ouvert, documenté et **ré-importable**. Aucun verrouillage :',
    'vous pouvez repartir de ces fichiers à tout moment, ici ou ailleurs.',
    '',
    `- Version du format : \`${manifest.version}\``,
    `- Cours d'origine : \`${manifest.courseId}\``,
    `- Exporté le : ${manifest.exportedAt}`,
    `- Sections : ${manifest.structure.sections} · Leçons : ${manifest.structure.lessons} · Quiz : ${manifest.structure.quizzes}`,
    `- Médias embarqués : ${manifest.media.length} fichier(s)`,
    '',
    '## Contenu',
    '',
    `- \`${F.manifest}\` — métadonnées + inventaire complet des médias.`,
    `- \`${F.course}\` — paramètres du cours (titre, langue, plan, marketing, ressources…).`,
    `- \`${F.sections}\` — sections, dans l'ordre.`,
    `- \`${F.lessons}\` — leçons, **avec le champ \`script\`** (slides, narration, TP) et les clés des médias.`,
    `- \`${F.quizzes}\` — quiz, rattachés par ordre de section/leçon.`,
    `- \`${MASTER_ARCHIVE_MEDIA_DIR}/\` — tous les médias (vidéos, audio, sous-titres, images, articles…),`,
    `  rangés sous le même chemin relatif que dans le stockage d'origine.`,
    '',
    '## Format',
    '',
    'Les références sont **par ordre** (`sectionOrder`, `lessonOrder`), jamais par',
    'identifiant interne : le re-import recrée des documents neufs sans dépendre',
    "des ID d'origine. Les champs marketing / ressources / plan sont du JSON brut,",
    'préservés tels quels.',
    '',
    '## Re-import',
    '',
    'Dans SallyCourse : page « Mes cours » → **Importer une archive**, puis',
    'déposez ce fichier ZIP. Un nouveau cours est créé à l\'identique (contenu +',
    'médias ré-uploadés), **sans aucune régénération par IA** — donc sans coût.',
    '',
    'Ailleurs : les fichiers JSON sont directement exploitables, et chaque média',
    `est retrouvable via son \`subKey\` listé dans \`${F.manifest}\`.`,
    '',
  ].join('\n');
}
