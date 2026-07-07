// Tests de l'adapter LMS interne (Prompt 43) en mode MOCK : aucun accès Mongo
// (guardMock court-circuite les écritures), on vérifie le flow, les capacités
// et l'URL /learn de statut. Le contexte est minimal (champs lus par l'adapter).
import { describe, expect, it, vi } from 'vitest';
import { lmsAdapter } from './lms.js';
import { getAdapter, hasAdapter } from '../registry.js';
import type { DeployContext } from '../types.js';
import type { ILesson } from '../../shared.js';

/** Contexte mock minimal : logger silencieux, deployment factice, mock=true. */
function mockCtx(overrides: Partial<DeployContext> = {}): DeployContext {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as DeployContext['logger'];
  const deployment = {
    userId: 'user-1',
    checkpoint: { lessonIndex: 0, step: '' },
    logs: [] as { ts: Date; level: string; msg: string }[],
    save: vi.fn(async () => undefined),
  } as unknown as DeployContext['deployment'];

  const lessons = [
    { title: 'Intro', durationMin: 5 },
    { title: 'Chapitre 1', durationMin: 12 },
  ] as unknown as ILesson[];

  return {
    platform: 'internal',
    mode: 'auto',
    course: {
      _id: 'course-42',
      title: 'Cours de test',
      coverImageUrl: 'courses/course-42/marketing/cover.png',
      outline: { description: 'Un cours complet. Deuxième phrase ignorée.' },
    } as unknown as DeployContext['course'],
    sections: [],
    lessons,
    credentials: {},
    checkpoint: { lessonIndex: 0, step: '' },
    publishProgress: vi.fn(async () => undefined),
    logger,
    mock: true,
    deployment,
    ...overrides,
  };
}

describe('LmsAdapter', () => {
  it('est enregistré sous la plateforme « internal »', () => {
    expect(hasAdapter('internal')).toBe(true);
    expect(getAdapter('internal')).toBe(lmsAdapter);
  });

  it('déclare tous les modes et n’a pas besoin de navigateur', () => {
    expect(lmsAdapter.capabilities.needsBrowser).toBe(false);
    expect(lmsAdapter.capabilities.modes).toEqual(['auto', 'assisted', 'manual']);
  });

  it('exécute le flow complet en mock sans toucher Mongo', async () => {
    const ctx = mockCtx();

    await lmsAdapter.authenticate(ctx);
    const { externalId } = await lmsAdapter.createCourse(ctx);
    // externalId = courseId (aucun système externe).
    expect(externalId).toBe('course-42');

    await lmsAdapter.uploadLesson(ctx, ctx.lessons[0]!, 0);
    await lmsAdapter.setLandingPage(ctx);
    await lmsAdapter.submitForReview(ctx);
    const status = await lmsAdapter.getStatus(ctx);

    expect(status.status).toBe('published');
    expect(status.reviewState).toBe('published');
    // URL du catalogue interne (base vide par défaut).
    expect(status.externalUrl).toBe('/learn/course-42');

    // En mock, les logs sont préfixés « [mock] » et save() n'est jamais appelé.
    expect((ctx.deployment.save as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(ctx.deployment.logs.every((l) => l.msg.startsWith('[mock]'))).toBe(true);
  });
});
