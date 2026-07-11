// Tests de la politique de rétention des médias (Prompt 79) :
//  1) détection d'inactivité — fonctions pures, aucune I/O ;
//  2) purge sélective — storage mocké, vérifie qu'on ne supprime QUE les
//     clés intermédiaires d'un cours 'ready', jamais d'un cours 'failed'.
import { beforeEach, describe, expect, it, vi } from 'vitest';

// storageKeys est réutilisé tel quel (pur, aucune I/O) — seul deleteObject
// (et les modèles Mongoose) sont mockés.
const mockDeleteObject = vi.hoisted(() => vi.fn(async (_key: string) => undefined));

const mockSectionFind = vi.hoisted(() => vi.fn());
const mockLessonFind = vi.hoisted(() => vi.fn());
const mockCourseFind = vi.hoisted(() => vi.fn());
const mockCourseUpdateOne = vi.hoisted(() => vi.fn(async () => ({ acknowledged: true })));

vi.mock('../shared.js', async () => {
  const actual = await vi.importActual<typeof import('../shared.js')>('../shared.js');
  return {
    ...actual,
    deleteObject: mockDeleteObject,
    Section: { find: mockSectionFind },
    Lesson: { find: mockLessonFind },
    Course: { find: mockCourseFind, updateOne: mockCourseUpdateOne },
  };
});

import {
  ARCHIVE_INACTIVITY_DAYS,
  archiveInactiveCourses,
  intermediateKeysToPurge,
  isCourseInactive,
  purgeCourseIntermediateAssets,
  selectCoursesToArchive,
} from './retention.js';
import { storageKeys } from '../shared.js';

/** Construit un objet { select, lean } chaînable renvoyant `data`. */
function selectLean<T>(data: T) {
  return { select: () => ({ lean: async () => data }) };
}

beforeEach(() => {
  mockDeleteObject.mockClear();
  mockSectionFind.mockReset();
  mockLessonFind.mockReset();
  mockCourseFind.mockReset();
  mockCourseUpdateOne.mockClear();
});

describe('isCourseInactive — détection d\'inactivité (pure, dates)', () => {
  it('inactif si updatedAt a exactement 90 jours (seuil inclusif)', () => {
    const now = new Date('2026-07-11T00:00:00.000Z');
    const updatedAt = new Date('2026-04-12T00:00:00.000Z'); // exactement 90 jours avant
    expect(isCourseInactive(updatedAt, now, 90)).toBe(true);
  });

  it('actif si updatedAt a 89 jours (juste sous le seuil)', () => {
    const now = new Date('2026-07-11T00:00:00.000Z');
    const updatedAt = new Date('2026-04-13T00:00:00.000Z'); // 89 jours avant
    expect(isCourseInactive(updatedAt, now, 90)).toBe(false);
  });

  it('inactif si updatedAt est très ancien (largement au-delà du seuil)', () => {
    const now = new Date('2026-07-11T00:00:00.000Z');
    const updatedAt = new Date('2025-01-01T00:00:00.000Z');
    expect(isCourseInactive(updatedAt, now, ARCHIVE_INACTIVITY_DAYS)).toBe(true);
  });

  it('utilise le seuil par défaut (90 jours) si non précisé', () => {
    const now = new Date('2026-07-11T00:00:00.000Z');
    const updatedAt = new Date('2026-01-01T00:00:00.000Z'); // > 90 jours
    expect(isCourseInactive(updatedAt, now)).toBe(true);
  });
});

describe('selectCoursesToArchive — filtre pur (pas déjà archivé + inactif)', () => {
  const now = new Date('2026-07-11T00:00:00.000Z');

  it('sélectionne uniquement les cours inactifs non déjà archivés', () => {
    const courses = [
      { id: 'a', updatedAt: new Date('2025-01-01'), archived: false }, // inactif → sélectionné
      { id: 'b', updatedAt: new Date('2026-07-01'), archived: false }, // récent → non sélectionné
      { id: 'c', updatedAt: new Date('2025-01-01'), archived: true }, // déjà archivé → non sélectionné
    ];
    expect(selectCoursesToArchive(courses, now)).toEqual(['a']);
  });

  it('retourne un tableau vide si aucun cours ne correspond', () => {
    const courses = [{ id: 'a', updatedAt: new Date('2026-07-10'), archived: false }];
    expect(selectCoursesToArchive(courses, now)).toEqual([]);
  });
});

describe('intermediateKeysToPurge — calcul pur des clés à supprimer', () => {
  it('retourne les clés slide+audio pour une leçon "ready"', () => {
    const keys = intermediateKeysToPurge('course1', 0, 2, {
      lessonId: 'lesson1',
      status: 'ready',
      slideCount: 3,
    });
    const expected = storageKeys.course('course1').lesson(0, 2);
    expect(keys).toEqual([
      expected.slide(0),
      expected.audio(0),
      expected.slide(1),
      expected.audio(1),
      expected.slide(2),
      expected.audio(2),
    ]);
  });

  it('ne retourne AUCUNE clé pour une leçon "failed" (préserve le débogage)', () => {
    const keys = intermediateKeysToPurge('course1', 0, 0, {
      lessonId: 'lesson1',
      status: 'failed',
      slideCount: 5,
    });
    expect(keys).toEqual([]);
  });

  it('ne retourne aucune clé pour un statut quelconque autre que "ready"', () => {
    for (const status of ['pending', 'generating']) {
      expect(
        intermediateKeysToPurge('course1', 0, 0, { lessonId: 'l', status, slideCount: 2 }),
      ).toEqual([]);
    }
  });

  it('ne touche jamais la vidéo finale / srt / vtt (absentes du résultat)', () => {
    const keys = intermediateKeysToPurge('course1', 1, 0, {
      lessonId: 'lesson1',
      status: 'ready',
      slideCount: 1,
    });
    const lessonKeys = storageKeys.course('course1').lesson(1, 0);
    expect(keys).not.toContain(lessonKeys.video());
    expect(keys).not.toContain(lessonKeys.captionsSrt());
    expect(keys).not.toContain(lessonKeys.captionsVtt());
  });
});

describe('purgeCourseIntermediateAssets — purge sélective (storage mocké)', () => {
  it("supprime les clés intermédiaires d'une leçon 'ready', et SEULEMENT celles-là", async () => {
    mockSectionFind.mockReturnValue(selectLean([{ _id: 'sec1', order: 0 }]));
    mockLessonFind.mockReturnValue(
      selectLean([
        {
          _id: 'lessonReady',
          sectionId: 'sec1',
          order: 0,
          status: 'ready',
          script: { slides: [{}, {}] }, // 2 slides
        },
      ]),
    );

    const results = await purgeCourseIntermediateAssets('courseX');

    const expectedKeys = storageKeys.course('courseX').lesson(0, 0);
    expect(mockDeleteObject).toHaveBeenCalledWith(expectedKeys.slide(0));
    expect(mockDeleteObject).toHaveBeenCalledWith(expectedKeys.audio(0));
    expect(mockDeleteObject).toHaveBeenCalledWith(expectedKeys.slide(1));
    expect(mockDeleteObject).toHaveBeenCalledWith(expectedKeys.audio(1));
    expect(mockDeleteObject).toHaveBeenCalledTimes(4);

    // Jamais la vidéo finale / sous-titres.
    expect(mockDeleteObject).not.toHaveBeenCalledWith(expectedKeys.video());
    expect(mockDeleteObject).not.toHaveBeenCalledWith(expectedKeys.captionsSrt());
    expect(mockDeleteObject).not.toHaveBeenCalledWith(expectedKeys.captionsVtt());

    expect(results).toEqual([{ lessonId: 'lessonReady', purgedKeys: expect.any(Array), skipped: false }]);
    expect(results[0]!.purgedKeys).toHaveLength(4);
  });

  it("ne supprime RIEN pour une leçon 'failed' (permet le débogage)", async () => {
    mockSectionFind.mockReturnValue(selectLean([{ _id: 'sec1', order: 0 }]));
    mockLessonFind.mockReturnValue(
      selectLean([
        {
          _id: 'lessonFailed',
          sectionId: 'sec1',
          order: 0,
          status: 'failed',
          script: { slides: [{}, {}, {}] },
        },
      ]),
    );

    const results = await purgeCourseIntermediateAssets('courseY');

    expect(mockDeleteObject).not.toHaveBeenCalled();
    expect(results).toEqual([{ lessonId: 'lessonFailed', purgedKeys: [], skipped: true }]);
  });

  it('traite indépendamment plusieurs leçons : purge uniquement les "ready" du lot', async () => {
    mockSectionFind.mockReturnValue(selectLean([{ _id: 'sec1', order: 0 }]));
    mockLessonFind.mockReturnValue(
      selectLean([
        { _id: 'lessonReady', sectionId: 'sec1', order: 0, status: 'ready', script: { slides: [{}] } },
        { _id: 'lessonFailed', sectionId: 'sec1', order: 1, status: 'failed', script: { slides: [{}] } },
      ]),
    );

    const results = await purgeCourseIntermediateAssets('courseZ');

    expect(mockDeleteObject).toHaveBeenCalledTimes(2); // 1 slide + 1 audio pour la leçon ready seulement
    const byId = Object.fromEntries(results.map((r) => [r.lessonId, r]));
    expect(byId.lessonReady!.skipped).toBe(false);
    expect(byId.lessonFailed!.skipped).toBe(true);
    expect(byId.lessonFailed!.purgedKeys).toEqual([]);
  });

  it('continue la purge des clés suivantes même si une suppression échoue (best-effort)', async () => {
    mockSectionFind.mockReturnValue(selectLean([{ _id: 'sec1', order: 0 }]));
    mockLessonFind.mockReturnValue(
      selectLean([
        { _id: 'lessonReady', sectionId: 'sec1', order: 0, status: 'ready', script: { slides: [{}, {}] } },
      ]),
    );
    mockDeleteObject
      .mockImplementationOnce(async () => {
        throw new Error('S3 indisponible');
      })
      .mockImplementation(async () => undefined);

    const results = await purgeCourseIntermediateAssets('courseW');

    expect(mockDeleteObject).toHaveBeenCalledTimes(4);
    // 3 suppressions ont réussi (la première a jeté et n'est pas comptée dans purgedKeys).
    expect(results[0]!.purgedKeys).toHaveLength(3);
  });
});

describe('archiveInactiveCourses — archivage (Mongo mocké)', () => {
  it('marque archived=true uniquement les cours inactifs, laisse les autres intacts', async () => {
    const now = new Date('2026-07-11T00:00:00.000Z');
    mockCourseFind.mockReturnValue(
      selectLean([
        { _id: 'old', updatedAt: new Date('2025-01-01'), archived: false },
        { _id: 'recent', updatedAt: new Date('2026-07-10'), archived: false },
      ]),
    );

    const count = await archiveInactiveCourses(now);

    expect(count).toBe(1);
    expect(mockCourseUpdateOne).toHaveBeenCalledTimes(1);
    expect(mockCourseUpdateOne).toHaveBeenCalledWith(
      { _id: 'old' },
      { $set: { archived: true, archivedAt: now } },
    );
  });

  it('ne fait aucun appel si aucun cours candidat n\'est inactif', async () => {
    const now = new Date('2026-07-11T00:00:00.000Z');
    mockCourseFind.mockReturnValue(selectLean([{ _id: 'recent', updatedAt: new Date('2026-07-10'), archived: false }]));

    const count = await archiveInactiveCourses(now);

    expect(count).toBe(0);
    expect(mockCourseUpdateOne).not.toHaveBeenCalled();
  });
});
