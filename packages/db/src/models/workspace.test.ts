import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { Workspace } from './workspace';
import { LessonComment } from './lesson-comment';
import { Course } from './course';

// Validation pure (validateSync) — aucune connexion Mongo requise.

const oid = () => new Types.ObjectId();

describe('Workspace', () => {
  it('accepte un document valide avec des membres à rôles distincts', () => {
    const doc = new Workspace({
      ownerId: oid(),
      name: 'Équipe Marketing',
      members: [
        { userId: oid(), role: 'editor' },
        { userId: oid(), role: 'reviewer' },
      ],
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.members).toHaveLength(2);
  });

  it('rejette un rôle de membre inconnu', () => {
    const doc = new Workspace({
      ownerId: oid(),
      name: 'Équipe',
      members: [{ userId: oid(), role: 'admin' }],
    });
    const err = doc.validateSync();
    expect(err?.errors['members.0.role']).toBeDefined();
  });

  it('exige ownerId et name', () => {
    const doc = new Workspace({});
    const err = doc.validateSync();
    expect(err?.errors['ownerId']).toBeDefined();
    expect(err?.errors['name']).toBeDefined();
  });

  it('accepte un workspace sans membre (owner seul)', () => {
    const doc = new Workspace({ ownerId: oid(), name: 'Solo' });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.members).toEqual([]);
  });
});

describe('LessonComment', () => {
  it('accepte un commentaire valide', () => {
    const doc = new LessonComment({ lessonId: oid(), userId: oid(), text: 'Bon travail sur cette leçon.' });
    expect(doc.validateSync()).toBeUndefined();
  });

  it('exige lessonId, userId et text', () => {
    const doc = new LessonComment({});
    const err = doc.validateSync();
    expect(err?.errors['lessonId']).toBeDefined();
    expect(err?.errors['userId']).toBeDefined();
    expect(err?.errors['text']).toBeDefined();
  });
});

describe('Course — champs additifs Workspace (P138)', () => {
  it('accepte un cours sans workspace (comportement historique, valeurs par défaut null)', () => {
    const doc = new Course({ userId: oid(), title: 'Cours solo', difficulty: 'beginner' });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.workspaceId ?? null).toBeNull();
    expect(doc.approvedBy ?? null).toBeNull();
    expect(doc.approvedAt ?? null).toBeNull();
  });

  it('accepte un cours rattaché à un workspace avec approbation', () => {
    const doc = new Course({
      userId: oid(),
      title: 'Cours équipe',
      difficulty: 'beginner',
      workspaceId: oid(),
      approvedBy: oid(),
      approvedAt: new Date(),
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.workspaceId).toBeDefined();
    expect(doc.approvedBy).toBeDefined();
  });
});
