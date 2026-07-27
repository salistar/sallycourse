import { NextResponse } from 'next/server';
import { Course as CourseModel, TeamActivity, connectDb } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { requireCourseAccess } from '@/lib/workspace-access';

/**
 * POST /api/courses/[id]/approve-deploy — approbation d'équipe (Prompt 138) :
 * un membre owner/reviewer du Workspace du cours valide explicitement la
 * version courante, débloquant le déploiement (cf. checkApprovalGate côté
 * shared, appliquée par POST /api/courses/[id]/deploy et le worker). 403 si le
 * rôle de l'appelant n'autorise pas 'approve_deploy' (editor exclu) ; 404 si le
 * cours n'existe pas ou n'appartient à aucun Workspace accessible.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;

  await connectDb();

  const access = await requireCourseAccess(id, user.id, 'approve_deploy', 'title');
  if (!access) {
    return NextResponse.json({ error: 'Cours introuvable ou action non autorisée.', code: 'courseNotFoundOrUnauthorized' }, { status: 404 });
  }

  if (!access.course.workspaceId) {
    return NextResponse.json(
      { error: "Ce cours n'appartient à aucune équipe — aucune approbation requise.", code: 'courseHasNoTeamNoApproval' },
      { status: 409 },
    );
  }

  await CourseModel.updateOne(
    { _id: id },
    { $set: { approvedBy: user.id, approvedAt: new Date() } },
  );

  // Activité d'équipe — best-effort, ne bloque jamais l'approbation.
  try {
    await TeamActivity.create({
      workspaceId: access.course.workspaceId,
      userId: user.id,
      action: 'deploy_approved',
      detail: typeof access.course.title === 'string' ? access.course.title : undefined,
      targetId: id,
    });
  } catch {
    // Non bloquant.
  }

  return NextResponse.json({ id, approvedBy: user.id, approvedAt: new Date().toISOString() }, { status: 200 });
}
