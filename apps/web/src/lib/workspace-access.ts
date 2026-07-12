import { isValidObjectId } from 'mongoose';
import { Course as CourseModel, Workspace } from '@sallycourse/db';
import { canPerform, roleInWorkspace, type WorkspaceAction, type WorkspaceRole } from '@sallycourse/shared';

// Résolution d'accès à un cours pour la gestion d'équipe (Prompt 138) : un
// cours peut appartenir soit à un seul userId (comportement historique), soit
// à un Workspace (owner + membres à rôles). Ce helper centralise la double
// vérification pour les routes API qui doivent autoriser owner-solo OU
// membre-workspace, sans dupliquer la logique partout.

export interface CourseAccess {
  course: { _id: unknown; workspaceId?: unknown } & Record<string, unknown>;
  /** Rôle effectif de l'appelant : 'owner' si cours solo (comportement historique). */
  role: WorkspaceRole;
}

/**
 * Charge un cours par id et vérifie que `userId` y a accès (soit propriétaire
 * direct, soit membre du Workspace propriétaire). Renvoie null si le cours
 * n'existe pas ou que l'utilisateur n'y a aucun accès (404 côté appelant — on
 * ne distingue jamais "existe mais interdit" de "n'existe pas").
 * `select` : champs additionnels à projeter (au-delà de _id/userId/workspaceId).
 */
export async function loadCourseAccess(
  courseId: string,
  userId: string,
  select = '',
): Promise<CourseAccess | null> {
  if (!isValidObjectId(courseId)) return null;

  const course = await CourseModel.findById(courseId)
    .select(`_id userId workspaceId ${select}`.trim())
    .lean();
  if (!course) return null;

  // Cours solo historique : seul le propriétaire y accède, rôle 'owner' implicite.
  if (!course.workspaceId) {
    if (String(course.userId) !== userId) return null;
    return { course, role: 'owner' };
  }

  // Cours d'équipe : le propriétaire direct (userId legacy) OU un membre du
  // Workspace peut y accéder, selon le rôle résolu dans ce Workspace.
  const workspace = await Workspace.findById(course.workspaceId).lean();
  if (!workspace) {
    // Workspace référencé introuvable (incohérence) : replie sur l'accès legacy.
    if (String(course.userId) !== userId) return null;
    return { course, role: 'owner' };
  }

  const role = roleInWorkspace(
    { ownerId: String(workspace.ownerId), members: workspace.members.map((m) => ({ userId: String(m.userId), role: m.role })) },
    userId,
  );
  if (!role) {
    // Non-membre du workspace, mais éventuellement propriétaire legacy du cours.
    if (String(course.userId) !== userId) return null;
    return { course, role: 'owner' };
  }

  return { course, role };
}

/** Raccourci : accès + vérification d'une action sensible en une passe. */
export async function requireCourseAccess(
  courseId: string,
  userId: string,
  action: WorkspaceAction,
  select = '',
): Promise<CourseAccess | null> {
  const access = await loadCourseAccess(courseId, userId, select);
  if (!access) return null;
  if (!canPerform(access.role, action)) return null;
  return access;
}
