// Gestion d'équipe (Prompt 138, plan Business) — logique PURE de rôles et de
// gate d'approbation, partagée web (API routes) + worker (job deployment).
// Ne fait aucune I/O : l'appelant charge le Workspace/Course puis appelle ces
// fonctions pour décider d'une autorisation.

export const WORKSPACE_ROLES = ['owner', 'editor', 'reviewer'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/** Membre minimal nécessaire pour résoudre un rôle (DTO agnostique Mongoose). */
export interface WorkspaceMemberLike {
  userId: string;
  role: WorkspaceRole;
}

export interface WorkspaceLike {
  ownerId: string;
  members: WorkspaceMemberLike[];
}

/**
 * Rôle effectif d'un utilisateur dans un workspace : l'owner a toujours le
 * rôle 'owner' (même absent de `members`, cas normal — l'owner n'a pas besoin
 * de figurer dans son propre tableau de membres). Renvoie null si l'utilisateur
 * n'a aucun rapport avec ce workspace.
 */
export function roleInWorkspace(workspace: WorkspaceLike, userId: string): WorkspaceRole | null {
  if (workspace.ownerId === userId) return 'owner';
  const member = workspace.members.find((m) => m.userId === userId);
  return member?.role ?? null;
}

/**
 * Actions sensibles arbitrées par rôle. 'manage_members' et 'delete_course'
 * réservées à l'owner ; 'edit_course' ouverte à owner+editor ; 'approve_deploy'
 * ouverte à owner+reviewer (un owner peut toujours s'auto-approuver — équipe
 * réduite, cf. documentation facturation centralisée).
 */
export type WorkspaceAction = 'manage_members' | 'delete_course' | 'edit_course' | 'approve_deploy' | 'comment';

const ACTION_ROLES: Record<WorkspaceAction, readonly WorkspaceRole[]> = {
  manage_members: ['owner'],
  delete_course: ['owner'],
  edit_course: ['owner', 'editor'],
  approve_deploy: ['owner', 'reviewer'],
  comment: ['owner', 'editor', 'reviewer'],
};

/**
 * Vérifie qu'un rôle donné autorise une action. Rôle null (non-membre) →
 * toujours refusé. Fonction PURE — aucune I/O, testable sans Mongo.
 */
export function canPerform(role: WorkspaceRole | null, action: WorkspaceAction): boolean {
  if (!role) return false;
  return ACTION_ROLES[action].includes(role);
}

/** Un Course minimal pour la gate d'approbation (DTO agnostique Mongoose). */
export interface ApprovalGateCourseLike {
  workspaceId?: string | null;
  approvedBy?: string | null;
  approvedAt?: Date | string | null;
}

export interface ApprovalGateResult {
  /** true = le déploiement peut être lancé. */
  allowed: boolean;
  /** Motif du refus, si allowed=false (à afficher côté UI/API). */
  reason?: string;
}

/**
 * Gate d'approbation avant déploiement (P138) : si le cours appartient à un
 * Workspace qui compte au moins un reviewer, une approbation (Course.approvedBy
 * non nul) est OBLIGATOIRE avant de pouvoir lancer un déploiement. Un cours
 * sans workspace, ou dont le workspace n'a aucun reviewer, n'est jamais bloqué
 * (rétrocompatible — comportement actuel inchangé pour tous les cours solo).
 * Fonction PURE.
 */
export function checkApprovalGate(
  course: ApprovalGateCourseLike,
  workspace: WorkspaceLike | null,
): ApprovalGateResult {
  if (!course.workspaceId || !workspace) return { allowed: true };

  const hasReviewer = workspace.members.some((m) => m.role === 'reviewer');
  if (!hasReviewer) return { allowed: true };

  if (course.approvedBy) return { allowed: true };

  return {
    allowed: false,
    reason:
      "Ce cours appartient à une équipe avec des relecteurs : une approbation est requise avant de pouvoir déployer.",
  };
}
