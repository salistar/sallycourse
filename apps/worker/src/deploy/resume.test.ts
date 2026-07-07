// Tests de la logique de reprise sur checkpoint (adapter factice mock).
import { describe, expect, it, vi } from 'vitest';
import { pendingLessonIndices, runResumableUploads } from './resume.js';
import { registerAdapter, getAdapter, clearAdapters, listAdapters } from './registry.js';
import type { DeployCheckpoint } from './types.js';
import { BaseDeploymentAdapter } from './base-adapter.js';
import type { DeployContext, DeployStatus } from './types.js';
import type { DeploymentMode, ILesson } from '../shared.js';

describe('pendingLessonIndices', () => {
  it('retourne toutes les leçons depuis un checkpoint neuf', () => {
    expect(pendingLessonIndices(3, { lessonIndex: 0, step: '' })).toEqual([0, 1, 2]);
  });

  it('ignore les leçons déjà uploadées (reprise)', () => {
    expect(pendingLessonIndices(4, { lessonIndex: 2, step: 'upload' })).toEqual([2, 3]);
  });

  it('retourne vide quand tout est déjà uploadé', () => {
    expect(pendingLessonIndices(3, { lessonIndex: 3, step: 'upload' })).toEqual([]);
  });

  it('borne un checkpoint aberrant au total', () => {
    expect(pendingLessonIndices(2, { lessonIndex: 99, step: '' })).toEqual([]);
    expect(pendingLessonIndices(2, { lessonIndex: -5, step: '' })).toEqual([0, 1]);
  });
});

describe('runResumableUploads', () => {
  it('uploade uniquement les leçons restantes et avance le checkpoint après chaque succès', async () => {
    const uploaded: number[] = [];
    const advances: number[] = [];
    const count = await runResumableUploads(
      4,
      { lessonIndex: 1, step: 'upload' },
      async (i) => void uploaded.push(i),
      async (next) => void advances.push(next),
    );
    expect(count).toBe(3);
    expect(uploaded).toEqual([1, 2, 3]);
    expect(advances).toEqual([2, 3, 4]); // checkpoint avance après chaque leçon
  });

  it("n'avance pas le checkpoint sur la leçon en échec (reprise possible)", async () => {
    const advances: number[] = [];
    const upload = vi.fn(async (i: number) => {
      if (i === 2) throw new Error('upload leçon 2 KO');
    });
    await expect(
      runResumableUploads(
        4,
        { lessonIndex: 0, step: '' },
        upload,
        async (next) => void advances.push(next),
      ),
    ).rejects.toThrow('upload leçon 2 KO');
    // Leçons 0 et 1 confirmées ; l'échec sur 2 stoppe avant advance(3).
    expect(advances).toEqual([1, 2]);
    expect(upload).toHaveBeenCalledTimes(3);
  });

  it('reprend exactement là où la première exécution a échoué', async () => {
    // 1re passe : échoue sur la leçon 2. On mémorise le dernier checkpoint.
    let checkpoint: DeployCheckpoint = { lessonIndex: 0, step: '' };
    const attempt1: number[] = [];
    await runResumableUploads(
      4,
      checkpoint,
      async (i) => {
        if (i === 2) throw new Error('crash');
        attempt1.push(i);
      },
      async (next) => void (checkpoint = { lessonIndex: next, step: 'upload' }),
    ).catch(() => undefined);
    expect(attempt1).toEqual([0, 1]);
    expect(checkpoint.lessonIndex).toBe(2);

    // 2e passe : repart du checkpoint, ne ré-uploade pas 0 et 1.
    const attempt2: number[] = [];
    const count = await runResumableUploads(
      4,
      checkpoint,
      async (i) => void attempt2.push(i),
      async (next) => void (checkpoint = { lessonIndex: next, step: 'upload' }),
    );
    expect(attempt2).toEqual([2, 3]);
    expect(count).toBe(2);
    expect(checkpoint.lessonIndex).toBe(4);
  });
});

// ── Adapter factice mock : flow complet via le registre ────────────
/** Leçon minimale pour piloter le flow (champs non lus par l'adapter factice). */
function fakeLesson(i: number): ILesson {
  return { title: `Leçon ${i}` } as unknown as ILesson;
}

class FakeAdapter extends BaseDeploymentAdapter {
  platform = 'fake';
  capabilities = { modes: ['auto', 'assisted'] as DeploymentMode[], needsBrowser: false };
  public calls: string[] = [];
  public uploaded: number[] = [];
  // baseDelayMs 0 en test : pas d'attente réelle sur les retries.
  protected retryOptions() {
    return { attempts: 2, baseDelayMs: 0 };
  }
  async authenticate(): Promise<void> {
    this.calls.push('authenticate');
  }
  async createCourse(): Promise<{ externalId: string }> {
    this.calls.push('createCourse');
    return { externalId: 'fake-123' };
  }
  async uploadLesson(_ctx: DeployContext, _lesson: ILesson, index: number): Promise<void> {
    this.uploaded.push(index);
  }
  async setLandingPage(): Promise<void> {
    this.calls.push('setLandingPage');
  }
  async submitForReview(): Promise<void> {
    this.calls.push('submitForReview');
  }
  async getStatus(): Promise<DeployStatus> {
    return { status: 'published', externalUrl: 'https://fake/course/123', reviewState: 'approved' };
  }
}

describe('registry + adapter factice', () => {
  it('enregistre, résout et exécute un flow mock complet avec reprise', async () => {
    clearAdapters();
    const adapter = new FakeAdapter();
    registerAdapter(adapter);
    expect(listAdapters()).toContain('fake');
    expect(getAdapter('fake')).toBe(adapter);

    // Simule le pilotage du flow par le processor, en mock (checkpoint à 1).
    await adapter.authenticate();
    await adapter.createCourse();
    const lessons = [fakeLesson(0), fakeLesson(1), fakeLesson(2)];
    let checkpoint: DeployCheckpoint = { lessonIndex: 1, step: 'upload' };
    await runResumableUploads(
      lessons.length,
      checkpoint,
      async (i) => adapter.uploadLesson({} as DeployContext, lessons[i]!, i),
      async (next) => void (checkpoint = { lessonIndex: next, step: 'upload' }),
    );
    await adapter.setLandingPage();
    await adapter.submitForReview();
    const status = await adapter.getStatus();

    expect(adapter.uploaded).toEqual([1, 2]); // leçon 0 déjà faite
    expect(status.status).toBe('published');
    expect(adapter.calls).toEqual(['authenticate', 'createCourse', 'setLandingPage', 'submitForReview']);
    clearAdapters();
  });

  it('getAdapter jette pour une plateforme inconnue', () => {
    clearAdapters();
    expect(() => getAdapter('inconnue')).toThrow(/inconnue/);
  });
});
