import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import {
  connectDb,
  Course as CourseModel,
  Lesson as LessonModel,
  LessonVersion,
  Quiz as QuizModel,
  Section as SectionModel,
} from '@sallycourse/db';
import { storageKeys, uploadObject, type QuizQuestion } from '@sallycourse/shared';
import { requireApiUser } from '@/lib/session';

/**
 * POST /api/lessons/[id]/versions/[versionId]/restore — réapplique le
 * snapshot d'une version passée (P131) : article → réupload du Markdown,
 * script vidéo → remplace Lesson.script, quiz → remplace les questions du
 * document Quiz associé. Repasse la leçon en 'pending' comme toute édition
 * manuelle (sauf pour le quiz, sans asset dérivé).
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id, versionId } = await params;
  if (!isValidObjectId(id) || !isValidObjectId(versionId)) {
    return NextResponse.json({ error: 'Version introuvable.' }, { status: 404 });
  }

  await connectDb();

  const lesson = await LessonModel.findById(id);
  if (!lesson) {
    return NextResponse.json({ error: 'Leçon introuvable.' }, { status: 404 });
  }

  const course = await CourseModel.findOne({ _id: lesson.courseId, userId: user.id })
    .select('_id')
    .lean();
  if (!course) {
    return NextResponse.json({ error: 'Leçon introuvable.' }, { status: 404 });
  }

  const version = await LessonVersion.findOne({ _id: versionId, lessonId: id }).lean();
  if (!version) {
    return NextResponse.json({ error: 'Version introuvable.' }, { status: 404 });
  }

  const snapshot = version.snapshot as
    | { articleMd?: string; script?: unknown; questions?: QuizQuestion[] }
    | null
    | undefined;

  if (!snapshot || typeof snapshot !== 'object') {
    return NextResponse.json({ error: 'Version corrompue.' }, { status: 409 });
  }

  // ── Quiz : restaure les questions du document Quiz, pas de statut leçon
  // à invalider (aucun asset dérivé du quiz). ──────────────────────────
  if (snapshot.questions !== undefined) {
    await QuizModel.updateOne(
      { lessonId: lesson._id },
      { $set: { questions: snapshot.questions } },
    );
    return NextResponse.json({ id: lesson._id.toString(), status: lesson.status });
  }

  if (snapshot.articleMd !== undefined) {
    if (lesson.type !== 'article') {
      return NextResponse.json({ error: 'Cette leçon n’est pas un article.' }, { status: 409 });
    }
    const section = await SectionModel.findById(lesson.sectionId).select('order').lean();
    if (!section) {
      return NextResponse.json({ error: 'Section introuvable.' }, { status: 404 });
    }
    const key = storageKeys.course(lesson.courseId.toString()).lesson(section.order, lesson.order).article();
    try {
      await uploadObject(key, snapshot.articleMd, 'text/markdown; charset=utf-8');
    } catch {
      return NextResponse.json(
        { error: 'Impossible de restaurer l’article, réessayez plus tard.' },
        { status: 503 },
      );
    }
    lesson.assets.articleMd = key;
  } else if (snapshot.script !== undefined) {
    lesson.script = snapshot.script;
  } else {
    return NextResponse.json({ error: 'Version corrompue.' }, { status: 409 });
  }

  lesson.status = 'pending';
  lesson.contentHash = undefined;
  await lesson.save();

  return NextResponse.json({ id: lesson._id.toString(), status: lesson.status });
}
