import { describe, expect, it } from 'vitest';
import {
  MASTER_ARCHIVE_VERSION,
  masterArchiveSubKey,
  mediaArchivePath,
  parseMasterArchiveFiles,
  serializeMasterArchiveFiles,
  type ILesson,
  type MasterArchive,
  type MasterArchiveMediaEntry,
} from '../shared.js';
import {
  buildMasterArchiveCourse,
  buildMasterArchiveLessons,
  buildMasterArchiveManifest,
  buildMasterArchiveQuizzes,
  buildMasterArchiveSections,
  masterArchiveReadme,
  type MasterArchiveCourseDoc,
  type MasterArchiveQuizDoc,
  type MasterArchiveSectionDoc,
} from './master-archive.js';

const courseId = '650000000000000000000abc';

function courseDoc(): MasterArchiveCourseDoc {
  return {
    _id: { toString: () => courseId },
    title: 'Docker en pratique',
    difficulty: 'intermediate',
    locale: 'fr',
    watermark: false,
    outline: null,
    marketing: { content: { udemyDescription: 'desc' } },
    aiDisclosureAccepted: true,
    // Champs absents volontairement (ttsVoice, avatarId…) → non émis.
  };
}

const sectionDocs: MasterArchiveSectionDoc[] = [
  { _id: { toString: () => 'sec1' }, order: 0, title: 'Bases' },
  { _id: { toString: () => 'sec0' }, order: 1, title: 'Avancé' },
];

function lessonDoc(sectionId: string, order: number, extra: Partial<ILesson> = {}): ILesson {
  return {
    sectionId: { toString: () => sectionId } as unknown as ILesson['sectionId'],
    courseId: { toString: () => courseId } as unknown as ILesson['courseId'],
    order,
    title: `Leçon ${order}`,
    type: 'video',
    status: 'ready',
    assets: { screenshots: [], slides: [] },
    ...extra,
  } as ILesson;
}

describe('buildMasterArchiveCourse', () => {
  it('ne transporte que les champs définis (pas d\'identifiant d\'instance)', () => {
    const c = buildMasterArchiveCourse(courseDoc());
    expect(c.title).toBe('Docker en pratique');
    expect(c.difficulty).toBe('intermediate');
    expect(c.watermark).toBe(false);
    expect(c.marketing).toEqual({ content: { udemyDescription: 'desc' } });
    expect('ttsVoice' in c).toBe(false);
    expect('avatarId' in c).toBe(false);
    // Jamais de userId / _id.
    expect(Object.keys(c)).not.toContain('userId');
    expect(Object.keys(c)).not.toContain('_id');
  });
});

describe('build sections / lessons / quizzes', () => {
  const sectionOrderById = new Map(sectionDocs.map((s) => [s._id.toString(), s.order]));

  it('trie les sections par ordre', () => {
    expect(buildMasterArchiveSections(sectionDocs)).toEqual([
      { order: 0, title: 'Bases' },
      { order: 1, title: 'Avancé' },
    ]);
  });

  it('rattache les leçons par ordre de section et préserve le script', () => {
    const lessons = [
      lessonDoc('sec1', 1, { script: { slides: [{ template: 'title', narration: 'n' }] } }),
      lessonDoc('sec1', 0),
      lessonDoc('sec0', 0, { type: 'article', assets: { articleMd: 'k', screenshots: [], slides: [] } }),
    ];
    const built = buildMasterArchiveLessons(lessons, sectionOrderById);
    // Triées : (sectionOrder 0, order 0), (0,1), (1,0)
    expect(built.map((l) => [l.sectionOrder, l.order])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
    ]);
    expect(built[1]!.script).toEqual({ slides: [{ template: 'title', narration: 'n' }] });
  });

  it('rattache les quiz par ordre de section/leçon', () => {
    const lessonOrderById = new Map<string, number>([['les1', 2]]);
    const quizzes: MasterArchiveQuizDoc[] = [
      {
        sectionId: { toString: () => 'sec1' },
        lessonId: { toString: () => 'les1' },
        questions: [{ question: 'q', choices: ['a', 'b', 'c', 'd'], correctIndex: 1, explanation: '', difficulty: 'beginner' }],
      },
    ];
    const built = buildMasterArchiveQuizzes(quizzes, sectionOrderById, lessonOrderById);
    expect(built).toEqual([
      {
        sectionOrder: 0,
        lessonOrder: 2,
        questions: [{ question: 'q', choices: ['a', 'b', 'c', 'd'], correctIndex: 1, explanation: '', difficulty: 'beginner' }],
      },
    ]);
  });
});

describe('manifest + readme + serialize round-trip', () => {
  it('produit un manifeste valide, un README documenté et une archive re-parsable', () => {
    const course = buildMasterArchiveCourse(courseDoc());
    const sections = buildMasterArchiveSections(sectionDocs);
    const sectionOrderById = new Map(sectionDocs.map((s) => [s._id.toString(), s.order]));
    const lessons = buildMasterArchiveLessons([lessonDoc('sec1', 0)], sectionOrderById);
    const quizzes = buildMasterArchiveQuizzes([], sectionOrderById, new Map());

    const videoKey = `courses/${courseId}/sections/0/lessons/0/video.mp4`;
    const subKey = masterArchiveSubKey(videoKey, courseId)!;
    const media: MasterArchiveMediaEntry[] = [{ subKey, path: mediaArchivePath(subKey) }];

    const manifest = buildMasterArchiveManifest({
      courseId,
      exportedAt: '2026-07-15T00:00:00.000Z',
      sections,
      lessons,
      quizzes,
      media,
    });
    expect(manifest.version).toBe(MASTER_ARCHIVE_VERSION);
    expect(manifest.structure).toEqual({ sections: 2, lessons: 1, quizzes: 0 });

    const archive: MasterArchive = { manifest, course, sections, lessons, quizzes };
    const readme = masterArchiveReadme(archive);
    expect(readme).toContain('Docker en pratique');
    expect(readme).toContain('Re-import');
    expect(readme).toContain('script');

    const files = serializeMasterArchiveFiles(archive);
    const reparsed = parseMasterArchiveFiles((name) => files[name]);
    expect(reparsed).toEqual(archive);
  });
});
