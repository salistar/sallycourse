import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import { QUEUES, defaultJobOptions, makeJobId, priorityForPlan } from '@sallycourse/shared';
import {
  connectDb,
  Course as CourseModel,
  GenerationJob as GenerationJobModel,
  Lesson as LessonModel,
  Section as SectionModel,
} from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { getContentQueue } from '@/lib/queues';
import { approveOutlinePayloadSchema } from '@/lib/outline-payload';
import { dispatchWebhook } from '@/lib/deploy/webhooks';

/**
 * POST /api/courses/[id]/approve-outline — validation du plan par l'utilisateur :
 * réécrit Sections/Lessons depuis le payload de l'éditeur, passe le cours en
 * 'generating' et enfile un job 'content-generation' PAR leçon. 404 volontaire
 * (pas 403) pour ne pas révéler les cours des autres utilisateurs.
 */
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('invalidJson');
  }

  const parsed = approveOutlinePayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Plan invalide.', code: 'invalidPlan2', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  await connectDb();

  const course = await CourseModel.findOne({ _id: id, userId: user.id });
  if (!course) {
    return apiError('courseNotFound');
  }

  // Le plan n'est validable que pendant la revue (évite les doubles soumissions).
  if (course.status !== 'outline-review') {
    return NextResponse.json(
      { error: `Le plan n'est pas en attente de validation (statut : ${course.status}).`, code: 'approveOutlinePlanNotUnderReview', params: { status: course.status } },
      { status: 409 },
    );
  }

  // ── Réécriture du plan : purge puis recréation depuis le payload ──
  const { sections } = parsed.data;

  await Promise.all([
    LessonModel.deleteMany({ courseId: course._id }),
    SectionModel.deleteMany({ courseId: course._id }),
  ]);

  const sectionDocs = await SectionModel.insertMany(
    sections.map((section, index) => ({
      courseId: course._id,
      order: index,
      title: section.title,
    })),
  );

  const lessonDocs = await LessonModel.insertMany(
    sections.flatMap((section, sectionIndex) => {
      // insertMany préserve l'ordre : sectionDocs[i] correspond à sections[i].
      const sectionDoc = sectionDocs[sectionIndex];
      if (!sectionDoc) return [];
      return section.lessons.map((lesson, lessonIndex) => ({
        courseId: course._id,
        sectionId: sectionDoc._id,
        order: lessonIndex,
        title: lesson.title,
        type: lesson.type,
        status: 'pending',
        durationMin: lesson.durationMin,
        summary: lesson.summary,
      }));
    }),
  );

  const courseId = course._id.toString();

  // ── Enqueue de la PREMIÈRE leçon uniquement (P19) ──────────────
  // Les leçons sont générées SÉQUENTIELLEMENT : chaque job de contenu enfile la
  // suivante à la fin, de sorte que chacune dispose du contexte (résumés) des
  // précédentes. lessonDocs[0] est la 1re leçon de la 1re section (flatMap
  // préserve l'ordre section puis position).
  try {
    await GenerationJobModel.findOneAndUpdate(
      { courseId: course._id },
      { $set: { step: QUEUES.content, progress: 0 }, $unset: { error: '' } },
      { upsert: true },
    );

    const firstLesson = lessonDocs[0];
    if (firstLesson) {
      const queue = getContentQueue();
      const lessonId = firstLesson._id.toString();
      const jobId = makeJobId(courseId, QUEUES.content, lessonId);
      // Un run précédent garderait le jobId réservé : purge avant re-add.
      await queue.remove(jobId).catch(() => undefined);
      await queue.add(
        'lesson-content',
        { courseId, lessonId },
        // Priorité BullMQ selon le plan (P73) — business/pro passent devant free.
        { ...defaultJobOptions, jobId, priority: priorityForPlan(user.plan) },
      );
    }
  } catch {
    // Redis indisponible : le cours reste en revue, l'utilisateur peut réessayer.
    return NextResponse.json(
      { error: 'Impossible de lancer la génération, réessayez plus tard.', code: 'cannotStartGeneration2' },
      { status: 503 },
    );
  }

  // Statut mis à jour APRÈS l'enqueue : pas de cours bloqué en 'generating'
  // si Redis est indisponible.
  course.status = 'generating';
  await course.save();

  // Notifie les webhooks abonnés (fire-and-forget : ne bloque pas la réponse).
  void dispatchWebhook(user.id!, 'outline_ready', {
    courseId,
    title: course.title,
    sections: sectionDocs.length,
    lessons: lessonDocs.length,
  });

  return NextResponse.json(
    { id: courseId, status: course.status, sections: sectionDocs.length, lessons: lessonDocs.length },
    { status: 202 },
  );
}
