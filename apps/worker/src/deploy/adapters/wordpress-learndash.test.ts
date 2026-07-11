// Tests de l'adapter WordPress/LearnDash & Tutor LMS (Prompt 108) : mapping
// pur des deux plugins (post types + meta d'association), construction des
// requêtes wp-json (pure), flow complet en mode MOCK (aucun appel réseau).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILesson, ISection } from '../../shared.js';
import { getAdapter, hasAdapter } from '../registry.js';
import type { DeployContext } from '../types.js';
import {
  buildCoursePostPayload,
  buildCourseDescriptionHtml,
  buildLandingPagePayload,
  buildLessonContentHtml,
  buildLessonPostPayload,
  resolveLmsPluginConfig,
  wpApiRoot,
  wpAuthHeader,
  wpCourseUrl,
  WordPressLearnDashAdapter,
  WORDPRESS_PLATFORM,
} from './wordpress-learndash.js';
// Importe le module pour déclencher l'enregistrement (effet de bord).
import './wordpress-learndash.js';

/* ------------------------------------------------------------------ */
/* Mapping des plugins (LearnDash vs Tutor)                            */
/* ------------------------------------------------------------------ */

describe('resolveLmsPluginConfig', () => {
  it('retourne la config LearnDash par défaut', () => {
    const cfg = resolveLmsPluginConfig(undefined);
    expect(cfg).toEqual({
      plugin: 'learndash',
      coursePostType: 'sfwd-courses',
      lessonPostType: 'sfwd-lessons',
      courseMetaKey: 'course_id',
    });
  });

  it('retourne la config Tutor LMS quand demandé', () => {
    const cfg = resolveLmsPluginConfig('tutor');
    expect(cfg).toEqual({
      plugin: 'tutor',
      coursePostType: 'courses',
      lessonPostType: 'lesson',
      courseMetaKey: '_tutor_course_id_for_lesson',
    });
  });

  it('replie sur LearnDash pour une valeur inconnue', () => {
    expect(resolveLmsPluginConfig('autre').plugin).toBe('learndash');
  });
});

/* ------------------------------------------------------------------ */
/* Helpers purs — wp-json                                              */
/* ------------------------------------------------------------------ */

describe('wpApiRoot', () => {
  it('construit la racine REST en retirant le slash final', () => {
    expect(wpApiRoot('https://client.example/')).toBe('https://client.example/wp-json/wp/v2');
    expect(wpApiRoot('https://client.example')).toBe('https://client.example/wp-json/wp/v2');
  });
});

describe('wpAuthHeader', () => {
  it('encode user:appPassword en Basic base64', () => {
    const header = wpAuthHeader('admin', 'abcd 1234');
    const expected = `Basic ${Buffer.from('admin:abcd 1234', 'utf-8').toString('base64')}`;
    expect(header).toBe(expected);
  });
});

describe('buildCoursePostPayload', () => {
  it('construit le post cours en draft', () => {
    expect(buildCoursePostPayload('Mon Cours', '<p>desc</p>')).toEqual({
      title: 'Mon Cours',
      content: '<p>desc</p>',
      status: 'draft',
    });
  });
});

describe('buildLessonContentHtml', () => {
  const lesson = { title: 'Leçon 1', summary: 'Résumé' } as unknown as ILesson;

  it('inclut la vidéo puis l’article si les deux sont fournis', () => {
    const html = buildLessonContentHtml(lesson, '<p>article</p>', 'https://cdn/video.mp4');
    expect(html).toContain('wp-block-video');
    expect(html).toContain('https://cdn/video.mp4');
    expect(html).toContain('<p>article</p>');
  });

  it('replie sur le résumé sans article ni vidéo', () => {
    expect(buildLessonContentHtml(lesson, null, null)).toBe('<p>Résumé</p>');
  });

  it('replie sur le titre si ni article ni résumé', () => {
    const bare = { title: 'Titre seul' } as unknown as ILesson;
    expect(buildLessonContentHtml(bare, null, null)).toBe('<p>Titre seul</p>');
  });
});

describe('buildLessonPostPayload', () => {
  it('associe la leçon au cours via le champ meta LearnDash', () => {
    const cfg = resolveLmsPluginConfig('learndash');
    const payload = buildLessonPostPayload(cfg, { title: 'Leçon 1' }, '<p>x</p>', '42', 0);
    expect(payload).toEqual({
      title: 'Leçon 1',
      content: '<p>x</p>',
      status: 'publish',
      menu_order: 1,
      meta: { course_id: '42' },
    });
  });

  it('associe la leçon au cours via le champ meta Tutor', () => {
    const cfg = resolveLmsPluginConfig('tutor');
    const payload = buildLessonPostPayload(cfg, { title: 'Leçon 2' }, '<p>y</p>', '99', 2);
    expect(payload).toEqual({
      title: 'Leçon 2',
      content: '<p>y</p>',
      status: 'publish',
      menu_order: 3,
      meta: { _tutor_course_id_for_lesson: '99' },
    });
  });
});

describe('buildLandingPagePayload', () => {
  it('enveloppe le HTML de description dans { content }', () => {
    expect(buildLandingPagePayload('<p>desc</p>')).toEqual({ content: '<p>desc</p>' });
  });
});

describe('wpCourseUrl', () => {
  it('construit une URL canonique indépendante des permaliens', () => {
    expect(wpCourseUrl('https://client.example/', 'sfwd-courses', '42')).toBe(
      'https://client.example/?p=42&post_type=sfwd-courses',
    );
  });
});

describe('buildCourseDescriptionHtml', () => {
  it('inclut le titre et le nombre de leçons', () => {
    const html = buildCourseDescriptionHtml('Mon Cours', 5);
    expect(html).toContain('Mon Cours');
    expect(html).toContain('5 leçon(s)');
  });
});

/* ------------------------------------------------------------------ */
/* Flow complet en mode MOCK                                           */
/* ------------------------------------------------------------------ */

/** Fabrique un DeployContext minimal en mode mock (pas de réseau, pas de Mongo). */
function makeCtx(overrides: Partial<DeployContext> = {}): DeployContext {
  const deployment = {
    checkpoint: { lessonIndex: 0, step: '' },
    logs: [] as unknown[],
    externalUrl: undefined as string | undefined,
    save: vi.fn().mockResolvedValue(undefined),
  };
  const sections = [{ _id: 's1', order: 0, title: 'Section 1', courseId: 'c1' }] as unknown as ISection[];
  const lessons = [
    { _id: 'l1', sectionId: 's1', order: 0, title: 'Leçon 1', type: 'video', durationMin: 5, assets: {} },
    { _id: 'l2', sectionId: 's1', order: 1, title: 'Leçon 2', type: 'article', durationMin: 8, assets: {} },
  ] as unknown as ILesson[];
  return {
    platform: WORDPRESS_PLATFORM,
    mode: 'auto',
    course: { _id: 'c1', title: 'Mon cours', difficulty: 'débutant' } as unknown as DeployContext['course'],
    sections,
    lessons,
    credentials: {},
    checkpoint: deployment.checkpoint,
    publishProgress: vi.fn().mockResolvedValue(undefined),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as DeployContext['logger'],
    mock: true,
    deployment: deployment as unknown as DeployContext['deployment'],
    ...overrides,
  };
}

describe('WordPressLearnDashAdapter (mock)', () => {
  const fetchSpy = vi.fn(() => Promise.reject(new Error('réseau interdit en mock')));
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    fetchSpy.mockClear();
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("s'enregistre dans le registre sous 'wordpress-learndash'", () => {
    expect(hasAdapter('wordpress-learndash')).toBe(true);
    expect(getAdapter('wordpress-learndash').platform).toBe('wordpress-learndash');
  });

  it('déclare ses capacités (auto/assisted, sans navigateur)', () => {
    const adapter = new WordPressLearnDashAdapter();
    expect(adapter.capabilities).toEqual({ modes: ['auto', 'assisted'], needsBrowser: false });
  });

  it('déroule le flow complet sans aucun appel réseau (LearnDash par défaut)', async () => {
    const adapter = new WordPressLearnDashAdapter();
    const ctx = makeCtx();

    await adapter.authenticate(ctx);
    const { externalId } = await adapter.createCourse(ctx);
    expect(externalId).toMatch(/^wp_mock_/);
    ctx.externalId = externalId;

    for (let i = 0; i < ctx.lessons.length; i += 1) {
      await adapter.uploadLesson(ctx, ctx.lessons[i]!, i);
    }
    await adapter.setLandingPage(ctx);
    await adapter.submitForReview(ctx);
    const status = await adapter.getStatus(ctx);

    expect(status.status).toBe('published');
    expect(status.externalUrl).toContain('sfwd-courses');
    expect(status.reviewState).toBe('not_applicable');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('déroule le flow complet sans aucun appel réseau (Tutor LMS)', async () => {
    const adapter = new WordPressLearnDashAdapter();
    const ctx = makeCtx({ credentials: { lmsPlugin: 'tutor' } });

    await adapter.authenticate(ctx);
    const { externalId } = await adapter.createCourse(ctx);
    ctx.externalId = externalId;
    for (let i = 0; i < ctx.lessons.length; i += 1) {
      await adapter.uploadLesson(ctx, ctx.lessons[i]!, i);
    }
    await adapter.setLandingPage(ctx);
    await adapter.submitForReview(ctx);
    const status = await adapter.getStatus(ctx);

    expect(status.status).toBe('published');
    expect(status.externalUrl).toContain('post_type=courses');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('createCourse est idempotent quand externalId est déjà connu (reprise)', async () => {
    const adapter = new WordPressLearnDashAdapter();
    const ctx = makeCtx({ externalId: 'wp_existing_123' });
    const { externalId } = await adapter.createCourse(ctx);
    expect(externalId).toBe('wp_existing_123');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('journalise le flow sans appel réseau même sans credentials (mode mock)', async () => {
    const adapter = new WordPressLearnDashAdapter();
    const ctx = makeCtx({ externalId: 'wp_mock_c1' });
    await adapter.submitForReview(ctx);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(ctx.deployment.logs.length).toBeGreaterThan(0);
  });
});
