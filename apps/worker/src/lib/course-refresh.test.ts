// Tests de la mise à jour automatique des cours (Prompt 91) :
//  1) shouldCheckForOutdatedTopics — fonction pure, non-déclenchement < 1 trimestre ;
//  2) parsing de la réponse LLM (schémas Zod, mock déterministe) ;
//  3) orchestration runCourseRefreshCheck — Mongo/notify mockés, vérifie le
//     court-circuit sur cours récent et la persistance + notification sinon.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCourseFindById = vi.hoisted(() => vi.fn());
const mockLessonFind = vi.hoisted(() => vi.fn());
const mockNotify = vi.hoisted(() => vi.fn(async () => ({ notification: {}, emailed: false })));
const mockGetConfig = vi.hoisted(() => vi.fn(() => ({ MOCK_PROVIDERS: true })));

vi.mock('../shared.js', async () => {
  const actual = await vi.importActual<typeof import('../shared.js')>('../shared.js');
  return {
    ...actual,
    Course: { findById: mockCourseFindById, find: vi.fn() },
    Lesson: { find: mockLessonFind },
    notify: mockNotify,
    getConfig: mockGetConfig,
  };
});

import {
  REFRESH_QUARTER_DAYS,
  buildOutdatedTopicsUser,
  detectOutdatedTopics,
  mockOutdatedTopicsDetection,
  outdatedTopicsDetectionSchema,
  refreshSuggestionsSchema,
  runCourseRefreshCheck,
  shouldCheckForOutdatedTopics,
} from './course-refresh.js';

beforeEach(() => {
  mockCourseFindById.mockReset();
  mockLessonFind.mockReset();
  mockNotify.mockClear();
  mockGetConfig.mockClear();
});

describe('shouldCheckForOutdatedTopics — non-déclenchement sur cours récent (pure)', () => {
  it('ne déclenche pas pour un cours créé il y a moins d’un trimestre', () => {
    const now = new Date('2026-07-11T00:00:00Z');
    const createdAt = new Date('2026-06-01T00:00:00Z'); // ~40 jours
    expect(shouldCheckForOutdatedTopics(createdAt, now)).toBe(false);
  });

  it('déclenche pour un cours créé il y a plus d’un trimestre (90 j)', () => {
    const now = new Date('2026-07-11T00:00:00Z');
    const createdAt = new Date('2026-01-01T00:00:00Z'); // > 90 jours
    expect(shouldCheckForOutdatedTopics(createdAt, now)).toBe(true);
  });

  it('respecte exactement le seuil (>= thresholdDays déclenche)', () => {
    const now = new Date('2026-07-11T00:00:00Z');
    const createdAt = new Date(now.getTime() - REFRESH_QUARTER_DAYS * 24 * 60 * 60 * 1000);
    expect(shouldCheckForOutdatedTopics(createdAt, now)).toBe(true);
  });

  it('accepte un seuil personnalisé', () => {
    const now = new Date('2026-07-11T00:00:00Z');
    const createdAt = new Date('2026-07-01T00:00:00Z'); // 10 jours
    expect(shouldCheckForOutdatedTopics(createdAt, now, 5)).toBe(true);
    expect(shouldCheckForOutdatedTopics(createdAt, now, 30)).toBe(false);
  });
});

describe('mockOutdatedTopicsDetection (parsing déterministe hors-ligne)', () => {
  it('détecte un sujet à évolution rapide (mot-clé dans le titre)', () => {
    const detection = mockOutdatedTopicsDetection({ title: 'Maîtriser React et TypeScript' }, 200, ['Introduction', 'Hooks avancés']);
    expect(() => outdatedTopicsDetectionSchema.parse(detection)).not.toThrow();
    expect(detection.likelyOutdated).toBe(true);
    expect(detection.reasons.length).toBeGreaterThan(0);
    expect(detection.suggestedUpdates[0]?.lessonRef).toBe('Introduction');
  });

  it('ne détecte rien pour un sujet stable dans le temps', () => {
    const detection = mockOutdatedTopicsDetection({ title: 'Histoire de la Rome antique' }, 400, ['Chapitre 1']);
    expect(detection.likelyOutdated).toBe(false);
    expect(detection.reasons).toEqual([]);
    expect(detection.suggestedUpdates).toEqual([]);
  });

  it('ne suggère aucune leçon si le cours n’en a aucune', () => {
    const detection = mockOutdatedTopicsDetection({ title: 'Introduction au Cloud AWS' }, 200, []);
    expect(detection.likelyOutdated).toBe(true);
    expect(detection.suggestedUpdates).toEqual([]);
  });
});

describe('detectOutdatedTopics — mode mock (parsing réponse LLM simulée)', () => {
  it('retombe sur l’heuristique déterministe en MOCK_PROVIDERS', async () => {
    const detection = await detectOutdatedTopics({ title: 'Docker et Kubernetes en pratique' }, 150, ['Setup'], true);
    expect(outdatedTopicsDetectionSchema.safeParse(detection).success).toBe(true);
    expect(detection.likelyOutdated).toBe(true);
  });

  it('produit un résultat identique pour le même titre (déterminisme)', async () => {
    const a = await detectOutdatedTopics({ title: 'Cours de Python' }, 150, ['A', 'B'], true);
    const b = await detectOutdatedTopics({ title: 'Cours de Python' }, 150, ['A', 'B'], true);
    expect(a).toEqual(b);
  });
});

describe('buildOutdatedTopicsUser — construction du message utilisateur', () => {
  it('inclut le titre, l’âge et les leçons numérotées', () => {
    const user = buildOutdatedTopicsUser({ title: 'Cours X' }, 120, ['Leçon A', 'Leçon B']);
    expect(user).toContain('Cours X');
    expect(user).toContain('120 jours');
    expect(user).toContain('1. Leçon A');
    expect(user).toContain('2. Leçon B');
  });

  it('gère l’absence de leçons sans planter', () => {
    const user = buildOutdatedTopicsUser({ title: 'Cours Y' }, 100, []);
    expect(user).toContain('(aucune leçon listée)');
  });
});

describe('refreshSuggestionsSchema — validation de la structure persistée', () => {
  it('valide une détection complète avec métadonnées', () => {
    const stored = {
      likelyOutdated: true,
      reasons: ['évolution rapide'],
      suggestedUpdates: [{ lessonRef: 'Leçon 1', reason: 'API dépréciée' }],
      detectedAt: new Date().toISOString(),
      thresholdDays: 90,
    };
    expect(() => refreshSuggestionsSchema.parse(stored)).not.toThrow();
  });

  it('rejette un suggestedUpdates avec lessonRef vide', () => {
    const stored = {
      likelyOutdated: true,
      reasons: [],
      suggestedUpdates: [{ lessonRef: '', reason: 'x' }],
      detectedAt: new Date().toISOString(),
      thresholdDays: 90,
    };
    expect(() => refreshSuggestionsSchema.parse(stored)).toThrow();
  });
});

describe('runCourseRefreshCheck — orchestration (Mongo/notify mockés)', () => {
  it('ne fait rien (checked=false) pour un cours créé il y a moins d’un trimestre', async () => {
    const now = new Date('2026-07-11T00:00:00Z');
    const course = {
      _id: 'course-1',
      userId: 'user-1',
      title: 'Cours récent',
      createdAt: new Date('2026-06-15T00:00:00Z'),
      save: vi.fn(async () => undefined),
    };
    mockCourseFindById.mockResolvedValue(course);

    const outcome = await runCourseRefreshCheck('course-1', now);

    expect(outcome).toEqual({ courseId: 'course-1', checked: false, likelyOutdated: false, suggestionCount: 0 });
    expect(mockLessonFind).not.toHaveBeenCalled();
    expect(course.save).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('renvoie null si le cours est introuvable', async () => {
    mockCourseFindById.mockResolvedValue(null);
    const outcome = await runCourseRefreshCheck('inconnu');
    expect(outcome).toBeNull();
  });

  it('détecte, persiste et notifie pour un cours ancien probablement obsolète', async () => {
    const now = new Date('2026-07-11T00:00:00Z');
    const course = {
      _id: 'course-2',
      userId: 'user-2',
      title: 'Maîtriser React avancé',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      refreshSuggestions: null as unknown,
      save: vi.fn(async () => undefined),
    };
    mockCourseFindById.mockResolvedValue(course);
    mockLessonFind.mockReturnValue({
      sort: () => ({
        lean: async () => [
          { _id: 'l1', title: 'Introduction' },
          { _id: 'l2', title: 'Hooks avancés' },
        ],
      }),
    });

    const outcome = await runCourseRefreshCheck('course-2', now);

    expect(outcome?.checked).toBe(true);
    expect(outcome?.likelyOutdated).toBe(true);
    expect(course.save).toHaveBeenCalledTimes(1);
    expect(refreshSuggestionsSchema.safeParse(course.refreshSuggestions).success).toBe(true);
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledWith(
      'user-2',
      expect.objectContaining({ type: 'course_refresh_available', email: false }),
    );
  });

  it('persiste sans notifier si le sujet n’est probablement pas obsolète', async () => {
    const now = new Date('2026-07-11T00:00:00Z');
    const course = {
      _id: 'course-3',
      userId: 'user-3',
      title: 'Histoire de la philosophie antique',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      refreshSuggestions: null as unknown,
      save: vi.fn(async () => undefined),
    };
    mockCourseFindById.mockResolvedValue(course);
    mockLessonFind.mockReturnValue({ sort: () => ({ lean: async () => [] }) });

    const outcome = await runCourseRefreshCheck('course-3', now);

    expect(outcome?.checked).toBe(true);
    expect(outcome?.likelyOutdated).toBe(false);
    expect(course.save).toHaveBeenCalledTimes(1);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('n’applique jamais de régénération automatique (aucun appel à une queue de contenu)', async () => {
    // Le module course-refresh n'importe/n'utilise aucune queue de génération —
    // seule la persistance + notification sont exercées, jamais une régénération.
    const now = new Date('2026-07-11T00:00:00Z');
    const course = {
      _id: 'course-4',
      userId: 'user-4',
      title: 'Cours Docker avancé',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      refreshSuggestions: null as unknown,
      save: vi.fn(async () => undefined),
    };
    mockCourseFindById.mockResolvedValue(course);
    mockLessonFind.mockReturnValue({ sort: () => ({ lean: async () => [{ _id: 'l1', title: 'Setup' }] }) });

    await runCourseRefreshCheck('course-4', now);

    // Le cours lui-même ne doit jamais voir son status forcé à 'generating'.
    expect((course as unknown as { status?: string }).status).toBeUndefined();
  });
});
