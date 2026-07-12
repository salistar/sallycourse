import { describe, expect, it } from 'vitest';
import {
  canPerform,
  checkApprovalGate,
  roleInWorkspace,
  type WorkspaceLike,
} from './workspace-roles';

const workspace = (overrides: Partial<WorkspaceLike> = {}): WorkspaceLike => ({
  ownerId: 'owner-1',
  members: [
    { userId: 'editor-1', role: 'editor' },
    { userId: 'reviewer-1', role: 'reviewer' },
  ],
  ...overrides,
});

describe('roleInWorkspace', () => {
  it("renvoie 'owner' pour le propriétaire, même absent de members", () => {
    expect(roleInWorkspace(workspace(), 'owner-1')).toBe('owner');
  });

  it('renvoie le rôle du membre trouvé dans members', () => {
    expect(roleInWorkspace(workspace(), 'editor-1')).toBe('editor');
    expect(roleInWorkspace(workspace(), 'reviewer-1')).toBe('reviewer');
  });

  it("renvoie null pour un utilisateur sans rapport avec le workspace", () => {
    expect(roleInWorkspace(workspace(), 'stranger')).toBeNull();
  });
});

describe('canPerform — vérification de rôle avant action sensible', () => {
  it("l'owner peut tout faire (gestion membres, suppression, édition, approbation)", () => {
    expect(canPerform('owner', 'manage_members')).toBe(true);
    expect(canPerform('owner', 'delete_course')).toBe(true);
    expect(canPerform('owner', 'edit_course')).toBe(true);
    expect(canPerform('owner', 'approve_deploy')).toBe(true);
  });

  it("l'editor peut éditer et commenter, mais pas gérer les membres ni approuver", () => {
    expect(canPerform('editor', 'edit_course')).toBe(true);
    expect(canPerform('editor', 'comment')).toBe(true);
    expect(canPerform('editor', 'manage_members')).toBe(false);
    expect(canPerform('editor', 'approve_deploy')).toBe(false);
    expect(canPerform('editor', 'delete_course')).toBe(false);
  });

  it('le reviewer peut approuver et commenter, mais pas éditer ni gérer les membres', () => {
    expect(canPerform('reviewer', 'approve_deploy')).toBe(true);
    expect(canPerform('reviewer', 'comment')).toBe(true);
    expect(canPerform('reviewer', 'edit_course')).toBe(false);
    expect(canPerform('reviewer', 'manage_members')).toBe(false);
  });

  it('un rôle null (non-membre) est toujours refusé, quelle que soit l\'action', () => {
    expect(canPerform(null, 'comment')).toBe(false);
    expect(canPerform(null, 'approve_deploy')).toBe(false);
  });
});

describe('checkApprovalGate — blocage du déploiement avant approbation reviewer', () => {
  it("autorise un cours SANS workspace (comportement historique inchangé)", () => {
    const result = checkApprovalGate({ workspaceId: null, approvedBy: null }, null);
    expect(result.allowed).toBe(true);
  });

  it('autorise un cours avec workspace mais SANS reviewer (rien à valider)', () => {
    const ws = workspace({ members: [{ userId: 'editor-1', role: 'editor' }] });
    const result = checkApprovalGate({ workspaceId: 'ws-1', approvedBy: null }, ws);
    expect(result.allowed).toBe(true);
  });

  it("bloque un cours avec workspace + reviewer tant qu'aucune approbation", () => {
    const result = checkApprovalGate({ workspaceId: 'ws-1', approvedBy: null }, workspace());
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it('autorise dès que approvedBy est renseigné', () => {
    const result = checkApprovalGate({ workspaceId: 'ws-1', approvedBy: 'reviewer-1' }, workspace());
    expect(result.allowed).toBe(true);
  });

  it('workspace introuvable (incohérence) : ne bloque pas (fail-open documenté)', () => {
    const result = checkApprovalGate({ workspaceId: 'ws-1', approvedBy: null }, null);
    expect(result.allowed).toBe(true);
  });
});
