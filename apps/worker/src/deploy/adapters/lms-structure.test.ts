// Tests du mapping de structure cours → sections → leçons partagé par les
// adapters LMS (Teachable, Thinkific), et des flux MOCK de chaque adapter.
// Logique PURE : aucun appel réseau/navigateur (mode mock forcé).
import { describe, expect, it } from 'vitest';
import {
  locateLesson,
  mapCourseStructure,
  mapLessonContentType,
} from './structure.js';
import { teachableAdapter } from './teachable.js';
import { thinkificAdapter } from './thinkific.js';
import type { DeployContext } from '../types.js';
import type { ICourse, ILesson, ISection } from '../../shared.js';

// ── Fixtures ────────────────────────────────────────────────────
/** ObjectId factice stable (chaîne, suffit au mapping par égalité de string). */
function oid(v: string): unknown {
  return { toString: () => v };
}

function fakeCourse(): ICourse {
  return {
    _id: oid('course1'),
    title: 'JavaScript de zéro',
    difficulty: 'beginner',
    marketing: null,
  } as unknown as ICourse;
}

function fakeSection(id: string, order: number, title: string): ISection {
  return { _id: oid(id), courseId: oid('course1'), order, title } as unknown as ISection;
}

function fakeLesson(
  sectionId: string,
  type: ILesson['type'],
  title: string,
  extra: Partial<ILesson> = {},
): ILesson {
  return {
    sectionId: oid(sectionId),
    courseId: oid('course1'),
    order: 0,
    title,
    type,
    status: 'ready',
    assets: { screenshots: [], slides: [], videoUrl: 'v.mp4', articleMd: '# a' },
    ...extra,
  } as unknown as ILesson;
}

/** Cours à 2 sections : S1 (2 leçons) + S2 (1 leçon). Ordre inversé exprès. */
function scenario() {
  const course = fakeCourse();
  const sections = [
    fakeSection('s2', 1, 'Fonctions'),
    fakeSection('s1', 0, 'Bases'),
  ];
  const lessons = [
    fakeLesson('s1', 'video', 'Variables'),
    fakeLesson('s1', 'article', 'Types'),
    fakeLesson('s2', 'quiz', 'Quiz fonctions'),
  ];
  return { course, sections, lessons };
}

/** Contexte mock minimal pour piloter un adapter sans I/O. */
function mockCtx(over: Partial<DeployContext> = {}): DeployContext {
  const { course, sections, lessons } = scenario();
  const logs: string[] = [];
  return {
    platform: 'lms',
    mode: 'auto',
    course,
    sections,
    lessons,
    credentials: {},
    checkpoint: { lessonIndex: 0, step: '' },
    publishProgress: async () => undefined,
    logger: { info() {}, warn() {}, error() {} } as unknown as DeployContext['logger'],
    mock: true,
    deployment: {
      checkpoint: { lessonIndex: 0, step: '' },
      logs: { push: (l: unknown) => logs.push(String((l as { msg?: string }).msg)) },
      save: async () => undefined,
    } as unknown as DeployContext['deployment'],
    ...over,
  };
}

// ── mapLessonContentType ────────────────────────────────────────
describe('mapLessonContentType', () => {
  it('mappe video→video, quiz→quiz, article/tp→text', () => {
    expect(mapLessonContentType(fakeLesson('s1', 'video', 'v'))).toBe('video');
    expect(mapLessonContentType(fakeLesson('s1', 'quiz', 'q'))).toBe('quiz');
    expect(mapLessonContentType(fakeLesson('s1', 'article', 'a'))).toBe('text');
    expect(mapLessonContentType(fakeLesson('s1', 'tp', 't'))).toBe('text');
  });
});

// ── mapCourseStructure ──────────────────────────────────────────
describe('mapCourseStructure', () => {
  it('regroupe les leçons sous leur section et trie les sections par ordre', () => {
    const { course, sections, lessons } = scenario();
    const tree = mapCourseStructure(course, sections, lessons);

    expect(tree.title).toBe('JavaScript de zéro');
    expect(tree.lessonCount).toBe(3);
    // Sections triées : Bases (order 0) avant Fonctions (order 1).
    expect(tree.sections.map((s) => s.title)).toEqual(['Bases', 'Fonctions']);
    expect(tree.sections[0]!.lessons.map((l) => l.title)).toEqual(['Variables', 'Types']);
    expect(tree.sections[1]!.lessons.map((l) => l.title)).toEqual(['Quiz fonctions']);
  });

  it('conserve les index absolus (position de checkpoint) des leçons', () => {
    const { course, sections, lessons } = scenario();
    const tree = mapCourseStructure(course, sections, lessons);
    expect(tree.sections[0]!.lessons.map((l) => l.index)).toEqual([0, 1]);
    expect(tree.sections[1]!.lessons.map((l) => l.index)).toEqual([2]);
  });

  it('projette les types de contenu par section', () => {
    const { course, sections, lessons } = scenario();
    const tree = mapCourseStructure(course, sections, lessons);
    expect(tree.sections[0]!.lessons.map((l) => l.contentType)).toEqual(['video', 'text']);
    expect(tree.sections[1]!.lessons.map((l) => l.contentType)).toEqual(['quiz']);
  });

  it('rattache une leçon orpheline (section inconnue) à une section « Divers »', () => {
    const { course, sections } = scenario();
    const lessons = [
      fakeLesson('s1', 'video', 'Variables'),
      fakeLesson('inconnue', 'article', 'Perdue'),
    ];
    const tree = mapCourseStructure(course, sections, lessons);
    const divers = tree.sections.find((s) => s.title === 'Divers');
    expect(divers).toBeDefined();
    expect(divers!.lessons.map((l) => l.title)).toEqual(['Perdue']);
  });
});

// ── locateLesson ────────────────────────────────────────────────
describe('locateLesson', () => {
  it('retrouve la section et la position d’une leçon par index absolu', () => {
    const { course, sections, lessons } = scenario();
    const tree = mapCourseStructure(course, sections, lessons);
    const found = locateLesson(tree, 2);
    expect(found?.section.title).toBe('Fonctions');
    expect(found?.sectionPosition).toBe(1);
    expect(found?.positionInSection).toBe(0);
    expect(locateLesson(tree, 99)).toBeNull();
  });
});

// ── Flux mock des adapters ──────────────────────────────────────
describe('TeachableAdapter (mock)', () => {
  it('déroule le flow complet sans I/O et renvoie un statut publié', async () => {
    const ctx = mockCtx({ platform: 'teachable' });
    await teachableAdapter.authenticate(ctx);
    const { externalId } = await teachableAdapter.createCourse(ctx);
    expect(externalId).toMatch(/^tch_course_/);
    expect(ctx.externalId).toBe(externalId);

    for (let i = 0; i < ctx.lessons.length; i += 1) {
      await teachableAdapter.uploadLesson(ctx, ctx.lessons[i]!, i);
    }
    await teachableAdapter.setLandingPage(ctx);
    await teachableAdapter.submitForReview(ctx);
    const status = await teachableAdapter.getStatus(ctx);
    expect(status.status).toBe('published');
    expect(status.externalUrl).toContain(externalId);
  });

  it('déclare needsBrowser (fallback Playwright documenté)', () => {
    expect(teachableAdapter.capabilities.needsBrowser).toBe(true);
    expect(teachableAdapter.platform).toBe('teachable');
  });
});

describe('ThinkificAdapter (mock)', () => {
  it('déroule le flow complet sans I/O et renvoie un statut publié', async () => {
    const ctx = mockCtx({ platform: 'thinkific' });
    await thinkificAdapter.authenticate(ctx);
    const { externalId } = await thinkificAdapter.createCourse(ctx);
    expect(externalId).toMatch(/^thk_course_/);

    for (let i = 0; i < ctx.lessons.length; i += 1) {
      await thinkificAdapter.uploadLesson(ctx, ctx.lessons[i]!, i);
    }
    await thinkificAdapter.setLandingPage(ctx);
    await thinkificAdapter.submitForReview(ctx);
    const status = await thinkificAdapter.getStatus(ctx);
    expect(status.status).toBe('published');
    expect(status.externalUrl).toContain('thinkific.com');
  });

  it('n’exige pas de navigateur (API REST complète)', () => {
    expect(thinkificAdapter.capabilities.needsBrowser).toBe(false);
    expect(thinkificAdapter.platform).toBe('thinkific');
  });
});
