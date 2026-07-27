import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { connectDb, Course as CourseModel, User as UserModel, Workspace } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';

/**
 * POST /api/workspaces — crée un Workspace (P138, validation d'équipe) et
 * rattache optionnellement un cours. Aucune route ne permettait de créer un
 * Workspace : TeamApprovalBanner/LessonComments étaient inatteignables (audit
 * connectivité 2026-07-17). Le créateur devient owner ; les membres invités
 * (par email, comptes EXISTANTS uniquement) reçoivent le rôle demandé.
 */

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2).max(80),
  /** Cours à rattacher immédiatement (doit appartenir au créateur). */
  courseId: z.string().optional(),
  /** Invitations : emails de comptes existants + rôle. */
  members: z
    .array(
      z.object({
        email: z.string().trim().email(),
        role: z.enum(['editor', 'reviewer']),
      }),
    )
    .max(10)
    .default([]),
});

export async function POST(request: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('invalidJson');
  }
  const parsed = createWorkspaceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Données invalides.', code: 'invalidData', details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  await connectDb();

  // Résolution des membres invités — comptes existants uniquement (pas
  // d'invitation email ici : le système d'email peut être non configuré).
  const members: { userId: unknown; role: 'owner' | 'editor' | 'reviewer' }[] = [
    { userId: user.id, role: 'owner' },
  ];
  const unknownEmails: string[] = [];
  for (const m of parsed.data.members) {
    const invited = await UserModel.findOne({ email: m.email.toLowerCase() }).select('_id').lean();
    if (!invited) {
      unknownEmails.push(m.email);
      continue;
    }
    if (String(invited._id) !== user.id) members.push({ userId: invited._id, role: m.role });
  }

  const workspace = await Workspace.create({
    ownerId: user.id,
    name: parsed.data.name,
    members,
  });

  // Rattachement optionnel d'un cours (ownership vérifié).
  if (parsed.data.courseId) {
    if (!isValidObjectId(parsed.data.courseId)) {
      return apiError('invalidCourseId');
    }
    const res = await CourseModel.updateOne(
      { _id: parsed.data.courseId, userId: user.id },
      { $set: { workspaceId: workspace._id } },
    );
    if (res.matchedCount === 0) {
      return apiError('courseNotFound');
    }
  }

  return NextResponse.json(
    {
      id: String(workspace._id),
      name: workspace.name,
      members: members.length,
      ...(unknownEmails.length > 0 ? { unknownEmails } : {}),
    },
    { status: 201 },
  );
}

/** GET /api/workspaces — workspaces dont l'utilisateur est membre. */
export async function GET() {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  await connectDb();
  const list = await Workspace.find({ 'members.userId': user.id }).sort({ createdAt: -1 }).lean();
  return NextResponse.json({
    workspaces: list.map((w) => ({
      id: String(w._id),
      name: w.name,
      members: (w.members ?? []).length,
      isOwner: String(w.ownerId) === user.id,
    })),
  });
}
