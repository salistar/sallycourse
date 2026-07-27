import {
  MASTER_ARCHIVE_VERSION,
  MasterArchiveParseError,
  outlineSchema,
  parseMasterArchiveFiles,
  rewriteCourseKey,
  storageKeyForSubKey,
  uploadObject,
  type MasterArchive,
} from '@sallycourse/shared';
import {
  connectDb,
  Course as CourseModel,
  Lesson as LessonModel,
  Quiz as QuizModel,
  Section as SectionModel,
} from '@sallycourse/db';
import { readZipEntries, ZipReadError } from './simple-unzip';
import { checkAndReserveCourseQuota, releaseQuota } from './quota';

/**
 * Re-import de l'archive maître (Prompt 182) — moitié « neuve » in-repo, sœur
 * de lib/create-course.ts createCourseForUser mais SANS aucun LLM : elle valide
 * le manifeste zod (source unique @sallycourse/shared/schemas/master-archive),
 * insère Course + Section + Lesson (avec script) + Quiz depuis les sources JSON,
 * puis ré-uploade tous les médias sous les clés du NOUVEAU cours.
 *
 * Portabilité : le rattachement des leçons/quiz se fait par ORDRE (jamais par
 * ObjectId d'origine), et toute référence de clé S3 `courses/{ancienId}/…` est
 * réécrite vers le nouvel identifiant — les médias étant ré-uploadés au même
 * sous-chemin, tout reste cohérent.
 */

/** Résultat du re-import. */
export interface ImportArchiveResult {
  id: string;
  title: string;
  sections: number;
  lessons: number;
  quizzes: number;
  media: number;
  /** Médias listés au manifeste mais absents/illisibles dans le ZIP (best-effort). */
  mediaMissing: number;
  /** Médias dont le ré-upload S3 a échoué (best-effort, cours créé malgré tout). */
  mediaFailed: number;
}

/** Échec de re-import (archive malformée). */
export class ImportArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportArchiveError';
  }
}

/** Quota mensuel de cours atteint : un re-import = un cours créé (P53). */
export class ImportQuotaError extends Error {
  readonly plan: string;
  readonly limit: number;
  constructor(plan: string, limit: number) {
    super(`Quota mensuel de cours atteint (plan ${plan}, limite ${limit}).`);
    this.name = 'ImportQuotaError';
    this.plan = plan;
    this.limit = limit;
  }
}

/**
 * Réécrit RÉCURSIVEMENT les clés S3 « course-scoped » d'une valeur JSON (assets
 * de leçon, clés marketing/ressources…) vers le nouveau cours, via la fonction
 * pure partagée `rewriteCourseKey`.
 *
 * SÉCURITÉ (anti cross-tenant, Prompt 182) : seules les clés commençant par
 * `courses/{from}/` (le préfixe de l'archive) sont réécrites en `courses/{to}/`.
 * Toute clé course-scoped d'un AUTRE cours (archive forgée pointant vers
 * `courses/{victimId}/…`) est NEUTRALISÉE (remplacée par `null`, jamais stockée
 * verbatim). Les chaînes non course-scoped (URLs, texte) sont inchangées. Pure.
 */
export function rekeyCourseReferences<T>(value: T, from: string, to: string): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return rewriteCourseKey(v, from, to); // string | null (clé forgée → null)
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  return walk(value) as T;
}

/**
 * Crée un cours complet à partir d'une archive maître (buffer ZIP) pour
 * l'utilisateur donné. Jette ImportArchiveError si l'archive est illisible ou
 * invalide. Les échecs de médias individuels sont best-effort (comptés, non
 * bloquants) : le contenu reste importé même si un média manque.
 */
export async function createCourseFromArchive(
  userId: string,
  zip: Buffer,
): Promise<ImportArchiveResult> {
  // 1) Décompression + lecture des fichiers texte.
  let entries: Map<string, Buffer>;
  try {
    entries = readZipEntries(zip);
  } catch (err) {
    if (err instanceof ZipReadError) throw new ImportArchiveError(err.message);
    throw err;
  }

  // 2) Validation via le schéma zod partagé (source unique export/import).
  let archive: MasterArchive;
  try {
    archive = parseMasterArchiveFiles((name) => entries.get(name)?.toString('utf8'));
  } catch (err) {
    if (err instanceof MasterArchiveParseError) throw new ImportArchiveError(err.message);
    throw err;
  }

  await connectDb();

  // 3) Réservation ATOMIQUE du quota mensuel (P53) — un re-import crée un cours,
  // il doit donc consommer un crédit comme la création normale (sinon
  // contournement du quota de plan). Vérifié APRÈS le parse (une archive
  // invalide ne consomme jamais de crédit).
  const reservation = await checkAndReserveCourseQuota(userId);
  if (!reservation.ok) {
    if (reservation.reason === 'quota_exceeded') {
      throw new ImportQuotaError(reservation.plan, reservation.limit);
    }
    throw new ImportArchiveError('Utilisateur introuvable.');
  }

  try {
    return await insertImportedCourse(userId, archive, entries);
  } catch (err) {
    // Échec après réservation : on rend le crédit (best-effort).
    await releaseQuota(userId);
    throw err;
  }
}

/**
 * Insère le cours importé (Course + Section + Lesson + Quiz + médias) une fois le
 * quota réservé. Isolée pour que `createCourseFromArchive` libère le crédit sur
 * tout échec de cette étape.
 */
async function insertImportedCourse(
  userId: string,
  archive: MasterArchive,
  entries: Map<string, Buffer>,
): Promise<ImportArchiveResult> {
  const oldCourseId = archive.manifest.courseId;
  const { course, sections, lessons, quizzes } = archive;

  // 3) Course (nouveaux champs, jamais d'identifiant d'instance importé). On
  // pré-alloue le document (donc son _id) AVANT de réécrire les clés S3, pour
  // connaître le préfixe cible `courses/{newId}/` (finding 1 — réécriture
  // sécurisée) au lieu d'un placeholder.
  const created = new CourseModel({
    userId,
    title: course.title,
    difficulty: course.difficulty,
    locale: course.locale,
    watermark: course.watermark ?? true,
    status: lessons.length > 0 ? 'ready' : 'draft',
    ...(course.ttsVoice ? { ttsVoice: course.ttsVoice } : {}),
    ...(course.narrationSpeed !== undefined ? { narrationSpeed: course.narrationSpeed } : {}),
    ...(course.generationMode ? { generationMode: course.generationMode } : {}),
    ...(course.llmProvider ? { llmProvider: course.llmProvider } : {}),
    ...(course.qualityScore !== undefined ? { qualityScore: course.qualityScore } : {}),
    ...(course.improvementSuggestions !== undefined
      ? { improvementSuggestions: course.improvementSuggestions }
      : {}),
    ...(course.advancedParams !== undefined ? { advancedParams: course.advancedParams } : {}),
    ...(course.aiDisclosureAccepted !== undefined
      ? { aiDisclosureAccepted: course.aiDisclosureAccepted }
      : {}),
    ...(course.backgroundMusicId ? { backgroundMusicId: course.backgroundMusicId } : {}),
    ...(course.musicVolume !== undefined ? { musicVolume: course.musicVolume } : {}),
    ...(course.jingleEnabled !== undefined ? { jingleEnabled: course.jingleEnabled } : {}),
    ...(course.avatarEnabled !== undefined ? { avatarEnabled: course.avatarEnabled } : {}),
    ...(course.avatarId ? { avatarId: course.avatarId } : {}),
    ...(course.useCustomVoice !== undefined ? { useCustomVoice: course.useCustomVoice } : {}),
    ...(course.providerMix !== undefined ? { providerMix: course.providerMix } : {}),
  });
  const newCourseId = created._id.toString();

  // outline (finding 2) : l'archive le transporte en JSON brut. On ne le persiste
  // QUE s'il satisfait outlineSchema — le modèle Course le valide sur save(), un
  // outline legacy/édité non conforme ferait sinon échouer TOUT le re-import.
  if (course.outline != null) {
    const parsedOutline = outlineSchema.safeParse(course.outline);
    if (parsedOutline.success) created.outline = parsedOutline.data;
  }

  // Réécriture SÉCURISÉE des clés S3 course-scoped (finding 1) : neutralise
  // toute clé forgée pointant vers le cours d'un tiers.
  if (course.marketing !== undefined) {
    created.set('marketing', rekeyCourseReferences(course.marketing, oldCourseId, newCourseId));
  }
  if (course.resources !== undefined) {
    created.set('resources', rekeyCourseReferences(course.resources, oldCourseId, newCourseId));
  }
  if (course.repurposing !== undefined) {
    created.set('repurposing', rekeyCourseReferences(course.repurposing, oldCourseId, newCourseId));
  }
  const coverKey = course.coverImageUrl
    ? rewriteCourseKey(course.coverImageUrl, oldCourseId, newCourseId)
    : null;
  if (coverKey) created.coverImageUrl = coverKey;

  await created.save();

  // 4) Sections — insérées dans l'ordre, map ordre → _id.
  const sectionIdByOrder = new Map<number, string>();
  for (const section of [...sections].sort((a, b) => a.order - b.order)) {
    const doc = await SectionModel.create({
      courseId: created._id,
      order: section.order,
      title: section.title,
    });
    sectionIdByOrder.set(section.order, doc._id.toString());
  }

  // 5) Leçons — rattachées par ordre de section, assets réécrits vers le nouvel id.
  const lessonIdBySectionAndOrder = new Map<string, string>();
  let insertedLessons = 0;
  for (const lesson of lessons) {
    const sectionId = sectionIdByOrder.get(lesson.sectionOrder);
    if (!sectionId) continue; // section absente (archive incohérente) : ignorée
    const assets = rekeyCourseReferences(lesson.assets ?? { screenshots: [], slides: [] }, oldCourseId, newCourseId);
    const doc = await LessonModel.create({
      courseId: created._id,
      sectionId,
      order: lesson.order,
      title: lesson.title,
      type: lesson.type,
      status: lesson.status ?? 'ready',
      ...(lesson.durationMin !== undefined ? { durationMin: lesson.durationMin } : {}),
      ...(lesson.summary !== undefined ? { summary: lesson.summary } : {}),
      ...(lesson.generatedSummary !== undefined ? { generatedSummary: lesson.generatedSummary } : {}),
      ...(lesson.script !== undefined ? { script: lesson.script } : {}),
      assets,
      ...(lesson.contentHash ? { contentHash: lesson.contentHash } : {}),
    });
    lessonIdBySectionAndOrder.set(`${lesson.sectionOrder}:${lesson.order}`, doc._id.toString());
    insertedLessons += 1;
  }

  // 6) Quiz — rattachés par ordre de section (+ leçon si connue).
  let insertedQuizzes = 0;
  for (const quiz of quizzes) {
    const sectionId = sectionIdByOrder.get(quiz.sectionOrder);
    if (!sectionId) continue;
    // Un Quiz exige un lessonId : à défaut de leçon rattachée, on prend la
    // première leçon de la section (contrat du modèle Quiz).
    const lessonId =
      (quiz.lessonOrder != null
        ? lessonIdBySectionAndOrder.get(`${quiz.sectionOrder}:${quiz.lessonOrder}`)
        : undefined) ?? firstLessonOfSection(lessonIdBySectionAndOrder, quiz.sectionOrder);
    if (!lessonId) continue; // aucune leçon dans la section : quiz orphelin ignoré
    await QuizModel.create({
      courseId: created._id,
      sectionId,
      lessonId,
      questions: quiz.questions,
    });
    insertedQuizzes += 1;
  }

  // 7) Médias — ré-upload sous les clés du nouveau cours (best-effort par fichier).
  let mediaOk = 0;
  let mediaMissing = 0;
  let mediaFailed = 0;
  for (const entry of archive.manifest.media) {
    const bytes = entries.get(entry.path);
    if (!bytes) {
      mediaMissing += 1;
      continue;
    }
    const key = storageKeyForSubKey(newCourseId, entry.subKey);
    try {
      await uploadObject(key, bytes, contentTypeForKey(entry.subKey));
      mediaOk += 1;
    } catch {
      mediaFailed += 1;
    }
  }

  return {
    id: newCourseId,
    title: course.title,
    sections: sectionIdByOrder.size,
    lessons: insertedLessons,
    quizzes: insertedQuizzes,
    media: mediaOk,
    mediaMissing,
    mediaFailed,
  };
}

/** Première leçon (plus petit ordre) d'une section, pour rattacher un quiz sans leçon explicite. */
function firstLessonOfSection(
  lessonIdBySectionAndOrder: ReadonlyMap<string, string>,
  sectionOrder: number,
): string | undefined {
  let best: { order: number; id: string } | undefined;
  for (const [key, id] of lessonIdBySectionAndOrder) {
    const [sec, ord] = key.split(':').map(Number);
    if (sec !== sectionOrder) continue;
    if (!best || ord! < best.order) best = { order: ord!, id };
  }
  return best?.id;
}

/** Content-Type deviné à partir de l'extension de la sous-clé (fallback binaire). */
export function contentTypeForKey(subKey: string): string {
  const ext = subKey.slice(subKey.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'mp4':
      return 'video/mp4';
    case 'mp3':
      return 'audio/mpeg';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'srt':
      return 'application/x-subrip';
    case 'vtt':
      return 'text/vtt';
    case 'txt':
      return 'text/plain; charset=utf-8';
    case 'md':
      return 'text/markdown; charset=utf-8';
    case 'json':
      return 'application/json';
    case 'xml':
      return 'application/xml';
    case 'pdf':
      return 'application/pdf';
    case 'epub':
      return 'application/epub+zip';
    default:
      return 'application/octet-stream';
  }
}

export { MASTER_ARCHIVE_VERSION };
