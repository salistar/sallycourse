import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { QUEUES, THEME_CATALOG_IDS, defaultJobOptions, makeJobId } from '@sallycourse/shared';
import { connectDb, Course as CourseModel, Lesson as LessonModel } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { getVideoRenderQueue } from '@/lib/queues';

/**
 * POST /api/courses/[id]/theme — change le THÈME visuel d'un cours (catalogue
 * 2026-07-26) : persiste Course.themeId puis re-rend les leçons vidéo
 * (video-render direct par leçon — les slides sont re-rendues avec le nouveau
 * thème et le MP4 ré-assemblé ; l'audio/le TTS ne sont PAS retouchés, les
 * fichiers audio en storage sont réutilisés tels quels). Les articles sont
 * thémés à l'affichage (wrapper CSS) — aucun re-rendu nécessaire pour eux.
 * 404 volontaire pour ne pas révéler les cours d'autrui.
 */

const bodySchema = z.object({
  themeId: z.enum(THEME_CATALOG_IDS),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return apiError('courseNotFound');
  }

  const parsedBody = bodySchema.safeParse(await request.json().catch(() => undefined));
  if (!parsedBody.success) {
    return apiError('invalidData');
  }

  await connectDb();

  const course = await CourseModel.findOne({ _id: id, userId: user.id });
  if (!course) {
    return apiError('courseNotFound');
  }
  if (course.status === 'generating' || course.status === 'outline-review') {
    return apiError('courseStillGenerating');
  }

  const previous = course.themeId;
  course.themeId = parsedBody.data.themeId;
  await course.save();

  // Re-rendu des leçons vidéo déjà produites avec le nouveau thème. Les leçons
  // sans vidéo (pending/failed) seront rendues au bon thème lors de leur
  // propre génération. Best-effort par leçon : une erreur d'enqueue n'annule
  // pas le changement de thème (le prochain rendu l'appliquera).
  let requeued = 0;
  if (previous !== parsedBody.data.themeId) {
    const videoLessons = await LessonModel.find({ courseId: id, type: 'video', status: 'ready' })
      .select('_id')
      .lean();
    const queue = getVideoRenderQueue();
    for (const lesson of videoLessons) {
      const lessonId = String(lesson._id);
      const jobId = makeJobId(id, QUEUES.videoRender, lessonId);
      try {
        await queue.remove(jobId).catch(() => undefined);
        await queue.add(QUEUES.videoRender, { courseId: id, lessonId }, { ...defaultJobOptions, jobId });
        requeued += 1;
      } catch {
        /* best-effort */
      }
    }
  }

  return NextResponse.json(
    { id: String(course._id), themeId: course.themeId, rerendering: requeued },
    { status: 200 },
  );
}
