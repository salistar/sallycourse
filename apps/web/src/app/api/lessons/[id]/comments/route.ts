import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { Lesson as LessonModel, LessonComment, TeamActivity, User as UserModel, connectDb } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { loadCourseAccess } from '@/lib/workspace-access';

/**
 * GET/POST /api/lessons/[id]/comments — commentaires d'équipe sur une leçon
 * (Prompt 138). Visible/utilisable uniquement en contexte Workspace (l'accès
 * exige que le cours parent appartienne à un Workspace dont l'appelant est
 * membre — un cours solo n'a pas de commentaires d'équipe). 'comment' est
 * ouvert à tous les rôles (owner/editor/reviewer).
 */

const commentSchema = z.object({
  text: z.string().trim().min(1).max(4000),
});

async function loadLessonWorkspaceAccess(lessonId: string, userId: string) {
  if (!isValidObjectId(lessonId)) return null;
  const lesson = await LessonModel.findById(lessonId).select('_id courseId').lean();
  if (!lesson) return null;
  const access = await loadCourseAccess(String(lesson.courseId), userId);
  if (!access || !access.course.workspaceId) return null;
  return { lesson, access };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  await connectDb();

  const resolved = await loadLessonWorkspaceAccess(id, user.id);
  if (!resolved) {
    return NextResponse.json({ error: 'Leçon introuvable.' }, { status: 404 });
  }

  const comments = await LessonComment.find({ lessonId: id })
    .sort({ createdAt: 1 })
    .lean();

  // Résolution des noms d'auteurs en un aller (évite un N+1 côté client).
  const authorIds = [...new Set(comments.map((c) => String(c.userId)))];
  const authors = await UserModel.find({ _id: { $in: authorIds } }).select('name').lean();
  const nameById = new Map(authors.map((a) => [String(a._id), a.name]));

  return NextResponse.json({
    comments: comments.map((c) => ({
      id: String(c._id),
      userId: String(c.userId),
      authorName: nameById.get(String(c.userId)) ?? 'Membre',
      text: c.text,
      createdAt: c.createdAt.toISOString(),
    })),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  await connectDb();

  const resolved = await loadLessonWorkspaceAccess(id, user.id);
  if (!resolved) {
    return NextResponse.json({ error: 'Leçon introuvable.' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 });
  }

  const parsed = commentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Commentaire invalide.', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const comment = await LessonComment.create({
    lessonId: id,
    userId: user.id,
    text: parsed.data.text,
  });

  // Activité d'équipe — best-effort, ne bloque jamais la création du commentaire.
  try {
    await TeamActivity.create({
      workspaceId: resolved.access.course.workspaceId,
      userId: user.id,
      action: 'comment_added',
      targetId: id,
    });
  } catch {
    // Non bloquant.
  }

  return NextResponse.json(
    {
      id: String(comment._id),
      userId: user.id,
      authorName: user.name ?? 'Vous',
      text: comment.text,
      createdAt: comment.createdAt.toISOString(),
    },
    { status: 201 },
  );
}
