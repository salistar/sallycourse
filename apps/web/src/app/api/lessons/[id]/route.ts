import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import {
  getObjectStream,
  outlineSchema,
  slideScriptSchema,
  storageKeys,
  tpSchema,
  uploadObject,
} from '@sallycourse/shared';
import {
  connectDb,
  Course as CourseModel,
  Lesson as LessonModel,
  LessonVersion,
  Quiz as QuizModel,
  Section as SectionModel,
} from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';

/**
 * PATCH /api/lessons/[id] — édition du contenu d'une leçon depuis l'éditeur :
 *  - article : réuploade le Markdown dans le stockage objet (même clé), pose
 *    Lesson.assets.articleMd et repasse la leçon en 'pending' (les captures
 *    dérivées deviennent obsolètes) ;
 *  - vidéo : remplace Lesson.script (slides éditées) et repasse en 'pending'
 *    (la vidéo rendue est invalidée jusqu'à régénération) ;
 *  - tp (Lot 5, plan 2026-07-20) : remplace Lesson.script (objectif/environnement/
 *    étapes/validation/dépannage édités) et repasse en 'pending' — les captures
 *    d'écran (asset séparé) restent inchangées, éditables indépendamment via
 *    POST/DELETE /api/courses/[id]/lessons/[lessonId]/screenshots.
 * N'invalide QUE la leçon touchée. 404 (et non 403) hors ownership.
 */

// Corps accepté : articleMd, script (vidéo) ou tp — au moins l'un des trois.
const patchLessonSchema = z
  .object({
    articleMd: z.string().min(1).optional(),
    script: slideScriptSchema.optional(),
    tp: tpSchema.optional(),
  })
  .refine((body) => body.articleMd !== undefined || body.script !== undefined || body.tp !== undefined, {
    message: 'Fournir « articleMd », « script » ou « tp ».',
  });

/** Télécharge le Markdown d'un article depuis le stockage objet (best-effort). */
async function readMarkdown(key: string): Promise<string | undefined> {
  try {
    const stream = await getObjectStream(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf-8');
  } catch {
    return undefined;
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return apiError('lessonNotFound');
  }

  const parsed = patchLessonSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Requête invalide.' },
      { status: 400 },
    );
  }

  await connectDb();

  const lesson = await LessonModel.findById(id);
  if (!lesson) {
    return apiError('lessonNotFound');
  }

  // Ownership via le cours parent.
  const course = await CourseModel.findOne({ _id: lesson.courseId, userId: user.id })
    .select('_id')
    .lean();
  if (!course) {
    return apiError('lessonNotFound');
  }

  const { articleMd, script, tp } = parsed.data;

  // ── Historique des versions (P131) : un instantané du contenu ÉDITABLE
  // précédent est versé avant toute édition significative (jamais à chaque
  // frappe — ce PATCH n'est appelé qu'à la sauvegarde manuelle/autosave
  // débouncée). Best-effort : une erreur d'écriture d'historique ne bloque
  // jamais la sauvegarde du contenu lui-même.
  try {
    if (articleMd !== undefined && lesson.assets.articleMd) {
      // Lesson.assets.articleMd est une CLÉ S3, pas le contenu : on
      // télécharge le Markdown réel pour que le diff/la restauration aient
      // un sens (sinon on figerait juste la clé, identique à chaque fois).
      const previousMarkdown = await readMarkdown(lesson.assets.articleMd);
      if (previousMarkdown !== undefined) {
        await LessonVersion.create({
          lessonId: lesson._id,
          snapshot: { articleMd: previousMarkdown },
        });
      }
    } else if (script !== undefined && lesson.script !== undefined && lesson.script !== null) {
      await LessonVersion.create({ lessonId: lesson._id, snapshot: { script: lesson.script } });
    } else if (tp !== undefined && lesson.script !== undefined && lesson.script !== null) {
      await LessonVersion.create({ lessonId: lesson._id, snapshot: { script: lesson.script } });
    }
  } catch {
    // Historique best-effort — on continue la sauvegarde du contenu.
  }

  // ── Article : type attendu 'article', réupload S3 + statut 'pending' ──
  if (articleMd !== undefined) {
    if (lesson.type !== 'article') {
      return NextResponse.json(
        { error: 'Cette leçon n’est pas un article.', code: 'lessonNotArticle' },
        { status: 409 },
      );
    }
    const section = await SectionModel.findById(lesson.sectionId).select('order').lean();
    if (!section) {
      return apiError('sectionNotFound');
    }
    const key = storageKeys
      .course(lesson.courseId.toString())
      .lesson(section.order, lesson.order)
      .article();
    try {
      await uploadObject(key, articleMd, 'text/markdown; charset=utf-8');
    } catch {
      return NextResponse.json(
        { error: 'Impossible d’enregistrer l’article, réessayez plus tard.', code: 'cannotSaveArticle' },
        { status: 503 },
      );
    }
    lesson.assets.articleMd = key;
  }

  // ── Script vidéo : type attendu 'video', remplace Lesson.script ──
  if (script !== undefined) {
    if (lesson.type !== 'video') {
      return NextResponse.json(
        { error: 'Cette leçon n’a pas de script vidéo.', code: 'lessonHasNoVideoScript' },
        { status: 409 },
      );
    }
    lesson.script = script;
  }

  // ── TP : type attendu 'tp', remplace Lesson.script (Lot 5, plan 2026-07-20) ──
  if (tp !== undefined) {
    if (lesson.type !== 'tp') {
      return NextResponse.json(
        { error: 'Cette leçon n’est pas un TP.', code: 'lessonNotTp' },
        { status: 409 },
      );
    }
    lesson.script = tp;
  }

  // Assets dérivés obsolètes : la leçon retombe en 'pending' jusqu'à la
  // prochaine production. contentHash effacé pour forcer la régénération.
  lesson.status = 'pending';
  lesson.contentHash = undefined;
  await lesson.save();

  return NextResponse.json({ id: lesson._id.toString(), status: lesson.status });
}

/**
 * DELETE /api/lessons/[id] — SUPPRIME une partie (leçon) d'un cours depuis le
 * dashboard (demande produit 2026-07-26, complément de l'ajout POST
 * /api/courses/[id]/lessons). Retire la leçon, son éventuel document Quiz, et
 * la synchronise hors de l'outline dénormalisé (best-effort). N'agit QUE sur
 * la leçon ciblée : le reste du cours reste intact. Refuse pendant la
 * génération initiale (chaîne séquentielle). 404 volontaire hors ownership.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return apiError('lessonNotFound');
  }

  await connectDb();

  const lesson = await LessonModel.findById(id);
  if (!lesson) {
    return apiError('lessonNotFound');
  }

  // Ownership via le cours parent.
  const course = await CourseModel.findOne({ _id: lesson.courseId, userId: user.id });
  if (!course) {
    return apiError('lessonNotFound');
  }
  // Pendant la génération initiale, la chaîne séquentielle réenfilerait la
  // leçon supprimée : on refuse tant que le cours n'est pas stabilisé.
  if (course.status === 'generating' || course.status === 'outline-review') {
    return apiError('courseStillGenerating');
  }

  const section = await SectionModel.findById(lesson.sectionId).select('order').lean();

  // Suppression : la leçon + son quiz éventuel (document séparé).
  await LessonModel.deleteOne({ _id: lesson._id });
  await QuizModel.deleteOne({ lessonId: lesson._id }).catch(() => undefined);

  // Synchronise l'outline dénormalisé (marketing/derive/translate le lisent) —
  // best-effort : retire la leçon à sa position dans la section.
  try {
    const parsedOutline = outlineSchema.safeParse(course.outline);
    if (parsedOutline.success && section) {
      const target = parsedOutline.data.sections[section.order];
      if (target) {
        // La position dans l'outline = ordre de la leçon dans la section.
        const remaining = await LessonModel.find({ sectionId: lesson.sectionId })
          .sort({ order: 1 })
          .select('title type durationMin summary')
          .lean();
        target.lessons = remaining.map((l) => ({
          title: l.title,
          type: l.type,
          durationMin: l.durationMin ?? 5,
          summary: l.summary ?? '',
        }));
        course.outline = parsedOutline.data;
        course.markModified('outline');
        await course.save();
      }
    }
  } catch {
    /* outline stale acceptable — les vues lisent les collections */
  }

  return NextResponse.json({ id, deleted: true }, { status: 200 });
}
