// Tests de la détection de delta pour la mise à jour ciblée (Prompt 46).
// Logique PURE : aucune DB ni réseau. On fabrique des leçons minimales.
import { describe, expect, it } from 'vitest';
import {
  lessonContentHash,
  detectLessonUpdates,
  nextSnapshot,
  pendingUpdateCursor,
  runResumableUpdates,
  hasPendingUpdates,
  type DeployedLessonSnapshot,
} from './updates.js';
import type { DeployCheckpoint } from './types.js';
import type { ILesson } from '../shared.js';

/** Override de leçon avec assets partiels (le reste du champ assets est complété). */
type LessonOverride = Partial<Omit<ILesson, 'assets'>> & { assets?: Record<string, unknown> };

/** Leçon minimale « prête » avec un id et des assets contrôlés. */
function lesson(id: string, overrides: LessonOverride = {}): ILesson {
  const { assets, ...rest } = overrides;
  return {
    _id: id,
    title: `Leçon ${id}`,
    type: 'video',
    status: 'ready',
    assets: {
      videoUrl: `courses/c/lesson-${id}/video.mp4`,
      screenshots: [],
      slides: [],
      ...assets,
    },
    ...rest,
  } as unknown as ILesson;
}

/** Instantané déployé cohérent avec l'état courant des leçons. */
function snapshotOf(lessons: ILesson[]): DeployedLessonSnapshot[] {
  return lessons.map((l) => ({
    lessonId: String((l as unknown as { _id: string })._id),
    contentHash: lessonContentHash(l),
    version: 1,
  }));
}

describe('lessonContentHash', () => {
  it('est déterministe et stable pour un même contenu', () => {
    const a = lesson('1');
    const b = lesson('1');
    expect(lessonContentHash(a)).toBe(lessonContentHash(b));
  });

  it('change quand la vidéo change', () => {
    const before = lessonContentHash(lesson('1'));
    const after = lessonContentHash(lesson('1', { assets: { videoUrl: 'other.mp4' } }));
    expect(after).not.toBe(before);
  });

  it('change quand le titre change', () => {
    const before = lessonContentHash(lesson('1'));
    const after = lessonContentHash(lesson('1', { title: 'Nouveau titre' }));
    expect(after).not.toBe(before);
  });

  it('intègre le contentHash source (article régénéré)', () => {
    const before = lessonContentHash(lesson('1', { type: 'article', contentHash: 'h1' }));
    const after = lessonContentHash(lesson('1', { type: 'article', contentHash: 'h2' }));
    expect(after).not.toBe(before);
  });
});

describe('detectLessonUpdates', () => {
  it('ne détecte rien quand rien n’a changé', () => {
    const lessons = [lesson('1'), lesson('2')];
    const plan = detectLessonUpdates(lessons, snapshotOf(lessons));
    expect(plan.updates).toHaveLength(0);
    expect(plan.total).toBe(2);
    expect(hasPendingUpdates(plan)).toBe(false);
  });

  it('détecte une leçon modifiée (kind=modified) avec son index absolu', () => {
    const original = [lesson('1'), lesson('2'), lesson('3')];
    const snap = snapshotOf(original);
    // La leçon d’index 1 est régénérée (nouvelle vidéo).
    const current = [lesson('1'), lesson('2', { assets: { videoUrl: 'new.mp4' } }), lesson('3')];
    const plan = detectLessonUpdates(current, snap);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]!.kind).toBe('modified');
    expect(plan.updates[0]!.index).toBe(1);
    expect(plan.updates[0]!.lessonId).toBe('2');
    expect(plan.updates[0]!.previousVersion).toBe(1);
  });

  it('détecte une leçon nouvelle (absente de l’instantané)', () => {
    const snap = snapshotOf([lesson('1')]);
    const current = [lesson('1'), lesson('2')];
    const plan = detectLessonUpdates(current, snap);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]!.kind).toBe('new');
    expect(plan.updates[0]!.lessonId).toBe('2');
    expect(plan.updates[0]!.previousVersion).toBe(0);
  });

  it('ignore les leçons non prêtes (régénération en cours)', () => {
    const snap = snapshotOf([lesson('1')]);
    const current = [
      lesson('1', { assets: { videoUrl: 'changed.mp4' }, status: 'generating' }),
    ];
    const plan = detectLessonUpdates(current, snap);
    expect(plan.updates).toHaveLength(0);
  });

  it('détecte plusieurs modifications dans l’ordre des index', () => {
    const original = [lesson('1'), lesson('2'), lesson('3')];
    const snap = snapshotOf(original);
    const current = [
      lesson('1', { assets: { videoUrl: 'a.mp4' } }),
      lesson('2'),
      lesson('3', { title: 'MAJ' }),
    ];
    const plan = detectLessonUpdates(current, snap);
    expect(plan.updates.map((u) => u.index)).toEqual([0, 2]);
  });
});

describe('nextSnapshot', () => {
  it('incrémente la version des leçons re-uploadées et conserve les autres', () => {
    const original = [lesson('1'), lesson('2')];
    const prev = snapshotOf(original);
    const current = [lesson('1', { assets: { videoUrl: 'v2.mp4' } }), lesson('2')];
    const plan = detectLessonUpdates(current, prev);
    const next = nextSnapshot(prev, plan.updates);

    const byId = new Map(next.map((s) => [s.lessonId, s]));
    expect(byId.get('1')!.version).toBe(2); // modifiée → v2
    expect(byId.get('2')!.version).toBe(1); // inchangée → v1
    expect(byId.get('1')!.contentHash).toBe(lessonContentHash(current[0]!));
  });

  it('ajoute les nouvelles leçons en version 1', () => {
    const prev = snapshotOf([lesson('1')]);
    const current = [lesson('1'), lesson('2')];
    const plan = detectLessonUpdates(current, prev);
    const next = nextSnapshot(prev, plan.updates);
    const byId = new Map(next.map((s) => [s.lessonId, s]));
    expect(byId.get('2')!.version).toBe(1);
    expect(next).toHaveLength(2);
  });
});

describe('pendingUpdateCursor', () => {
  it('repart de 0 hors reprise (step != update)', () => {
    expect(pendingUpdateCursor(3, { lessonIndex: 5, step: 'done' })).toBe(0);
  });
  it('reprend au curseur borné quand step=update', () => {
    expect(pendingUpdateCursor(3, { lessonIndex: 2, step: 'update' })).toBe(2);
    expect(pendingUpdateCursor(3, { lessonIndex: 99, step: 'update' })).toBe(3);
  });
});

describe('runResumableUpdates', () => {
  it('re-uploade toutes les updates et avance le curseur après chaque succès', async () => {
    const original = [lesson('1'), lesson('2'), lesson('3')];
    const snap = snapshotOf(original);
    const current = [
      lesson('1', { assets: { videoUrl: 'a.mp4' } }),
      lesson('2', { assets: { videoUrl: 'b.mp4' } }),
      lesson('3'),
    ];
    const plan = detectLessonUpdates(current, snap);
    const done: number[] = [];
    const advances: number[] = [];
    const count = await runResumableUpdates(
      plan.updates,
      { lessonIndex: 0, step: '' },
      async (u) => void done.push(u.index),
      async (next) => void advances.push(next),
    );
    expect(count).toBe(2);
    expect(done).toEqual([0, 1]);
    expect(advances).toEqual([1, 2]);
  });

  it('reprend là où une exécution précédente s’est arrêtée', async () => {
    const original = [lesson('1'), lesson('2'), lesson('3')];
    const snap = snapshotOf(original);
    const current = [
      lesson('1', { assets: { videoUrl: 'a.mp4' } }),
      lesson('2', { assets: { videoUrl: 'b.mp4' } }),
      lesson('3', { assets: { videoUrl: 'c.mp4' } }),
    ];
    const plan = detectLessonUpdates(current, snap);
    // Checkpoint : 2 updates déjà appliquées.
    const checkpoint: DeployCheckpoint = { lessonIndex: 2, step: 'update' };
    const done: number[] = [];
    const count = await runResumableUpdates(
      plan.updates,
      checkpoint,
      async (u) => void done.push(u.index),
      async () => undefined,
    );
    expect(count).toBe(1);
    expect(done).toEqual([2]); // seule la 3e update reste
  });
});
