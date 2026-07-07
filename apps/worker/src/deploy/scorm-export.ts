// Runner d'export SCORM (Prompt 42) : charge les données d'un cours depuis Mongo,
// résout le contenu/les assets depuis le stockage, puis STREAME le paquet SCORM
// (scorm.ts) vers storageKeys.course(id).exportFile('scorm.zip'). Séparé de
// scorm.ts (pur/testable) pour isoler les accès DB/stockage.

import { PassThrough, type Readable } from 'node:stream';
import {
  Course,
  Lesson,
  Quiz,
  Section,
  getObjectStream,
  objectExists,
  storageKeys,
  uploadObject,
  type ILesson,
} from '../shared.js';
import { logger } from '../queues/index.js';
import {
  SCORM_ZIP_FILENAME,
  buildScormItems,
  writeScormPackage,
  type ScormCourseModel,
  type ScormQuizQuestion,
  type ScormSource,
} from './scorm.js';

export interface ScormExportResult {
  courseId: string;
  /** Clé S3 du ZIP SCORM produit. */
  zipKey: string;
  items: number;
  assets: number;
}

/** Lit le contenu texte utf-8 d'un objet S3 ; null si absent/erreur. */
async function readTextObject(key: string): Promise<string | null> {
  try {
    const stream = (await getObjectStream(key)) as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    return Buffer.concat(chunks).toString('utf-8');
  } catch {
    return null;
  }
}

/**
 * Construit et persiste le paquet SCORM d'un cours. Retourne la clé S3 du ZIP.
 * Réutilisable par un processor ou un adapter (Moodle) qui préfère importer un
 * paquet SCORM plutôt que d'appeler les Web Services ressource par ressource.
 */
export async function exportCourseScorm(courseId: string): Promise<ScormExportResult> {
  const course = await Course.findById(courseId);
  if (!course) throw new Error(`cours introuvable : ${courseId}`);

  const [sections, lessons, quizzes] = await Promise.all([
    Section.find({ courseId: course._id }).sort({ order: 1 }).lean(),
    Lesson.find({ courseId: course._id }).sort({ order: 1 }).lean<ILesson[]>(),
    Quiz.find({ courseId: course._id }).lean(),
  ]);

  const quizzesBySection = new Map<string, ScormQuizQuestion[]>();
  for (const quiz of quizzes) {
    const sid = String(quiz.sectionId);
    const bucket = quizzesBySection.get(sid) ?? [];
    for (const q of quiz.questions) {
      bucket.push({
        question: q.question,
        choices: [...q.choices],
        correctIndex: q.correctIndex,
        explanation: q.explanation,
      });
    }
    quizzesBySection.set(sid, bucket);
  }

  const model: ScormCourseModel = {
    courseId,
    title: course.title,
    locale: course.locale,
    sections: sections.map((s) => ({ id: String(s._id), order: s.order, title: s.title })),
    lessons,
    quizzesBySection,
  };

  // Résout contenu/asset depuis le stockage (chemins de leçon par ordre).
  const sectionOrderById = new Map<string, number>(
    sections.map((s) => [String(s._id), s.order]),
  );
  const source: ScormSource = {
    async readArticle(lesson: ILesson): Promise<string | null> {
      const sOrder = sectionOrderById.get(String(lesson.sectionId)) ?? 0;
      const keys = storageKeys.course(courseId).lesson(sOrder, lesson.order);
      const mdKey = lesson.assets?.articleMd ?? keys.article();
      return readTextObject(mdKey);
    },
    async videoKey(lesson: ILesson): Promise<string | null> {
      const sOrder = sectionOrderById.get(String(lesson.sectionId)) ?? 0;
      const videoKey = storageKeys.course(courseId).lesson(sOrder, lesson.order).video();
      return (await objectExists(videoKey)) ? videoKey : null;
    },
  };

  const items = await buildScormItems(model, source);

  const zipKey = storageKeys.course(courseId).exportFile(SCORM_ZIP_FILENAME);
  const sink = new PassThrough();
  const uploadPromise = uploadObject(zipKey, sink, 'application/zip');

  try {
    const result = await writeScormPackage(model, items, sink, async (sourceKey) => {
      try {
        return (await getObjectStream(sourceKey)) as Readable;
      } catch {
        return null;
      }
    });
    await uploadPromise;
    logger.info({ courseId, zipKey, ...result }, 'paquet SCORM construit');
    return { courseId, zipKey, items: result.items, assets: result.assets };
  } catch (err) {
    sink.destroy();
    await uploadPromise.catch(() => undefined);
    logger.error({ courseId, err }, 'échec de l’export SCORM');
    throw err;
  }
}
