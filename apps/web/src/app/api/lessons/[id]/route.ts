import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import {
  slideScriptSchema,
  storageKeys,
  uploadObject,
} from '@sallycourse/shared';
import {
  connectDb,
  Course as CourseModel,
  Lesson as LessonModel,
  Section as SectionModel,
} from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';

/**
 * PATCH /api/lessons/[id] — édition du contenu d'une leçon depuis l'éditeur :
 *  - article : réuploade le Markdown dans le stockage objet (même clé), pose
 *    Lesson.assets.articleMd et repasse la leçon en 'pending' (les captures
 *    dérivées deviennent obsolètes) ;
 *  - vidéo : remplace Lesson.script (slides éditées) et repasse en 'pending'
 *    (la vidéo rendue est invalidée jusqu'à régénération).
 * N'invalide QUE la leçon touchée. 404 (et non 403) hors ownership.
 */

// Corps accepté : soit articleMd, soit script — au moins l'un des deux.
const patchLessonSchema = z
  .object({
    articleMd: z.string().min(1).optional(),
    script: slideScriptSchema.optional(),
  })
  .refine((body) => body.articleMd !== undefined || body.script !== undefined, {
    message: 'Fournir « articleMd » ou « script ».',
  });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: 'Leçon introuvable.' }, { status: 404 });
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
    return NextResponse.json({ error: 'Leçon introuvable.' }, { status: 404 });
  }

  // Ownership via le cours parent.
  const course = await CourseModel.findOne({ _id: lesson.courseId, userId: user.id })
    .select('_id')
    .lean();
  if (!course) {
    return NextResponse.json({ error: 'Leçon introuvable.' }, { status: 404 });
  }

  const { articleMd, script } = parsed.data;

  // ── Article : type attendu 'article', réupload S3 + statut 'pending' ──
  if (articleMd !== undefined) {
    if (lesson.type !== 'article') {
      return NextResponse.json(
        { error: 'Cette leçon n’est pas un article.' },
        { status: 409 },
      );
    }
    const section = await SectionModel.findById(lesson.sectionId).select('order').lean();
    if (!section) {
      return NextResponse.json({ error: 'Section introuvable.' }, { status: 404 });
    }
    const key = storageKeys
      .course(lesson.courseId.toString())
      .lesson(section.order, lesson.order)
      .article();
    try {
      await uploadObject(key, articleMd, 'text/markdown; charset=utf-8');
    } catch {
      return NextResponse.json(
        { error: 'Impossible d’enregistrer l’article, réessayez plus tard.' },
        { status: 503 },
      );
    }
    lesson.assets.articleMd = key;
  }

  // ── Script vidéo : type attendu 'video', remplace Lesson.script ──
  if (script !== undefined) {
    if (lesson.type !== 'video') {
      return NextResponse.json(
        { error: 'Cette leçon n’a pas de script vidéo.' },
        { status: 409 },
      );
    }
    lesson.script = script;
  }

  // Assets dérivés obsolètes : la leçon retombe en 'pending' jusqu'à la
  // prochaine production. contentHash effacé pour forcer la régénération.
  lesson.status = 'pending';
  lesson.contentHash = undefined;
  await lesson.save();

  return NextResponse.json({ id: lesson._id.toString(), status: lesson.status });
}
