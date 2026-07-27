import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { QUEUES, defaultJobOptions, makeJobId } from '@sallycourse/shared';
import { connectDb, Course as CourseModel, Lesson as LessonModel } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { getContentQueue } from '@/lib/queues';

/**
 * POST /api/lessons/[id]/regenerate — relance la génération de contenu d'une
 * leçon : vérifie l'ownership via le cours parent, enfile un job
 * 'content-generation' (jobId déterministe) puis repasse la leçon en
 * 'generating'. Corps optionnel { mode: 'render-only' | 'full' } : après une
 * édition de script, l'éditeur envoie 'full' pour relancer TTS + rendu à
 * partir du script sauvegardé. 404 volontaire (pas 403) pour ne pas révéler
 * l'existence d'une leçon d'un autre utilisateur.
 */

const bodySchema = z
  .object({
    mode: z.enum(['render-only', 'full']).optional(),
    // P171 — régénération CIBLÉE avec instructions libres (« plus d'exemples
    // marocains », « simplifie le vocabulaire ») injectées dans le prompt.
    instruction: z.string().trim().min(1).max(1000).optional(),
    // « Éditer avec l'IA » (2026-07-26) — force un provider LLM pour CETTE
    // régénération (id de LLM_PROVIDER_CATALOG). Absent → provider du cours.
    llmProviderId: z.string().trim().min(1).max(40).optional(),
  })
  .optional();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return apiError('lessonNotFound');
  }

  // Corps facultatif : un POST sans body reste valide (mode indéfini).
  const parsedBody = bodySchema.safeParse(await request.json().catch(() => undefined));
  const mode = parsedBody.success ? parsedBody.data?.mode : undefined;
  const instruction = parsedBody.success ? parsedBody.data?.instruction : undefined;
  const llmProviderId = parsedBody.success ? parsedBody.data?.llmProviderId : undefined;

  await connectDb();

  const lesson = await LessonModel.findById(id);
  if (!lesson) {
    return apiError('lessonNotFound');
  }

  // Ownership : la leçon doit appartenir à un cours de l'utilisateur.
  const course = await CourseModel.findOne({ _id: lesson.courseId, userId: user.id })
    .select('_id')
    .lean();
  if (!course) {
    return apiError('lessonNotFound');
  }

  const courseId = lesson.courseId.toString();
  const lessonId = lesson._id.toString();
  const jobId = makeJobId(courseId, QUEUES.content, lessonId);

  try {
    const queue = getContentQueue();
    // Une exécution précédente (terminée ou échouée) garderait le jobId
    // réservé : on la purge pour autoriser un vrai re-run.
    await queue.remove(jobId).catch(() => undefined);
    await queue.add(
      'regenerate-lesson',
      {
        courseId,
        lessonId,
        ...(mode ? { mode } : {}),
        ...(instruction ? { instruction } : {}),
        ...(llmProviderId ? { llmProviderId } : {}),
      },
      { ...defaultJobOptions, jobId },
    );
  } catch {
    return NextResponse.json(
      { error: 'Impossible de lancer la régénération, réessayez plus tard.', code: 'cannotRegenerate' },
      { status: 503 },
    );
  }

  // Statut mis à jour APRÈS l'enqueue : pas de leçon bloquée en 'generating'
  // si Redis est indisponible.
  lesson.status = 'generating';
  await lesson.save();

  return NextResponse.json({ id: lessonId, status: lesson.status }, { status: 202 });
}
