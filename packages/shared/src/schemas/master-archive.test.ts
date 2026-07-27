import { describe, expect, it } from 'vitest';
import {
  MASTER_ARCHIVE_FILENAMES,
  MASTER_ARCHIVE_VERSION,
  MasterArchiveParseError,
  masterArchiveSubKey,
  mediaArchivePath,
  parseMasterArchiveFiles,
  rewriteCourseKey,
  serializeMasterArchiveFiles,
  storageKeyForSubKey,
  subKeyFromMediaPath,
  type MasterArchive,
} from './master-archive';

function sampleArchive(): MasterArchive {
  return {
    manifest: {
      version: MASTER_ARCHIVE_VERSION,
      courseId: 'course-abc',
      exportedAt: '2026-07-15T10:00:00.000Z',
      generator: 'sallycourse-test',
      structure: { sections: 1, lessons: 2, quizzes: 1 },
      media: [
        { subKey: 'sections/0/lessons/0/video.mp4', path: 'media/sections/0/lessons/0/video.mp4' },
        { subKey: 'marketing/cover.png', path: 'media/marketing/cover.png' },
      ],
    },
    course: {
      title: 'Kubernetes de zéro',
      difficulty: 'beginner',
      locale: 'fr',
      watermark: false,
      outline: null,
      marketing: { content: { udemyDescription: 'desc' }, assets: { udemyCover: 'courses/course-abc/marketing/cover.png' } },
      resources: null,
      advancedParams: { tone: 'conversational' },
      aiDisclosureAccepted: true,
      providerMix: { llm: 'oss', tts: 'oss', image: 'cloud' },
    },
    sections: [{ order: 0, title: 'Introduction' }],
    lessons: [
      {
        sectionOrder: 0,
        order: 0,
        title: 'Bienvenue',
        type: 'video',
        status: 'ready',
        durationMin: 4,
        script: { slides: [{ template: 'title', narration: 'Bonjour' }] },
        assets: { videoUrl: 'courses/course-abc/sections/0/lessons/0/video.mp4', screenshots: [], slides: [] },
        contentHash: 'deadbeef',
      },
      {
        sectionOrder: 0,
        order: 1,
        title: 'Les pods',
        type: 'article',
        status: 'ready',
        script: null,
        assets: { articleMd: 'courses/course-abc/sections/0/lessons/1/article.md', screenshots: [], slides: [] },
      },
    ],
    quizzes: [
      {
        sectionOrder: 0,
        lessonOrder: 1,
        questions: [
          {
            question: 'Qu\'est-ce qu\'un pod ?',
            choices: ['A', 'B', 'C', 'D'],
            correctIndex: 0,
            explanation: 'Un pod est…',
            difficulty: 'beginner',
          },
        ],
      },
    ],
  };
}

describe('master-archive schema round-trip', () => {
  it('sérialise puis re-parse une archive identique (source unique export/import)', () => {
    const archive = sampleArchive();
    const files = serializeMasterArchiveFiles(archive);

    // Les 5 fichiers JSON attendus sont produits.
    expect(Object.keys(files).sort()).toEqual(
      [
        MASTER_ARCHIVE_FILENAMES.manifest,
        MASTER_ARCHIVE_FILENAMES.course,
        MASTER_ARCHIVE_FILENAMES.sections,
        MASTER_ARCHIVE_FILENAMES.lessons,
        MASTER_ARCHIVE_FILENAMES.quizzes,
      ].sort(),
    );

    const reparsed = parseMasterArchiveFiles((name) => files[name]);
    expect(reparsed).toEqual(archive);
    // Le script est bien préservé (exigence centrale du prompt).
    expect(reparsed.lessons[0]!.script).toEqual({ slides: [{ template: 'title', narration: 'Bonjour' }] });
  });

  it('jette une erreur explicite si un fichier manque', () => {
    const files = serializeMasterArchiveFiles(sampleArchive());
    delete files[MASTER_ARCHIVE_FILENAMES.lessons];
    expect(() => parseMasterArchiveFiles((name) => files[name])).toThrowError(MasterArchiveParseError);
  });

  it('jette une erreur si un JSON est corrompu', () => {
    const files = serializeMasterArchiveFiles(sampleArchive());
    files[MASTER_ARCHIVE_FILENAMES.course] = '{ not json';
    expect(() => parseMasterArchiveFiles((name) => files[name])).toThrowError(/JSON invalide/);
  });

  it('rejette une version d\'archive inconnue', () => {
    const files = serializeMasterArchiveFiles(sampleArchive());
    files[MASTER_ARCHIVE_FILENAMES.manifest] = JSON.stringify({
      ...JSON.parse(files[MASTER_ARCHIVE_FILENAMES.manifest]!),
      version: 999,
    });
    expect(() => parseMasterArchiveFiles((name) => files[name])).toThrowError(MasterArchiveParseError);
  });

  it('refuse une sous-clé média avec traversée de chemin', () => {
    const files = serializeMasterArchiveFiles(sampleArchive());
    const manifest = JSON.parse(files[MASTER_ARCHIVE_FILENAMES.manifest]!);
    manifest.media[0].subKey = '../../etc/passwd';
    files[MASTER_ARCHIVE_FILENAMES.manifest] = JSON.stringify(manifest);
    expect(() => parseMasterArchiveFiles((name) => files[name])).toThrowError(MasterArchiveParseError);
  });
});

describe('outline lâche (anti-lock-in, finding 2)', () => {
  it('accepte un outline NON conforme à outlineSchema (JSON brut préservé)', () => {
    const files = serializeMasterArchiveFiles(sampleArchive());
    const course = JSON.parse(files[MASTER_ARCHIVE_FILENAMES.course]!);
    // learningObjectives = 2 items → violerait outlineSchema (min 4) ; ne doit
    // PLUS faire échouer le parse de l'archive.
    course.outline = { title: 'legacy', learningObjectives: ['a', 'b'], sections: [] };
    files[MASTER_ARCHIVE_FILENAMES.course] = JSON.stringify(course);
    const reparsed = parseMasterArchiveFiles((name) => files[name]);
    expect(reparsed.course.outline).toEqual({
      title: 'legacy',
      learningObjectives: ['a', 'b'],
      sections: [],
    });
  });
});

describe('rewriteCourseKey (sécurité anti cross-tenant, finding 1)', () => {
  it('réécrit une clé du cours d\'origine vers le nouveau cours', () => {
    expect(rewriteCourseKey('courses/OLD/sections/0/lessons/0/video.mp4', 'OLD', 'NEW')).toBe(
      'courses/NEW/sections/0/lessons/0/video.mp4',
    );
  });

  it('NEUTRALISE (null) une clé course-scoped d\'un AUTRE cours (forgée)', () => {
    expect(rewriteCourseKey('courses/VICTIM/sections/0/lessons/0/video.mp4', 'OLD', 'NEW')).toBeNull();
    expect(rewriteCourseKey('courses/VICTIM/marketing/cover.png', 'OLD', 'NEW')).toBeNull();
  });

  it('NEUTRALISE (null) une clé de préfixe user-scoped d\'un tiers (voix/avatar)', () => {
    expect(rewriteCourseKey('voice-samples/VICTIM.audio', 'OLD', 'NEW')).toBeNull();
    expect(rewriteCourseKey('avatar-faces/VICTIM.png', 'OLD', 'NEW')).toBeNull();
  });

  it('laisse inchangée une chaîne qui n\'est pas une clé de stockage sensible', () => {
    expect(rewriteCourseKey('https://cdn.example/cover.png', 'OLD', 'NEW')).toBe(
      'https://cdn.example/cover.png',
    );
    // tts-cache est dédupliqué par hash de contenu (pas user-scoped) → non sensible.
    expect(rewriteCourseKey('tts-cache/abc.mp3', 'OLD', 'NEW')).toBe('tts-cache/abc.mp3');
    expect(rewriteCourseKey('Apprendre Docker de zéro', 'OLD', 'NEW')).toBe('Apprendre Docker de zéro');
  });
});

describe('master-archive key mapping', () => {
  it('mappe clé S3 ↔ sous-clé ↔ chemin d\'archive et retour', () => {
    const key = 'courses/course-abc/sections/0/lessons/0/video.mp4';
    const subKey = masterArchiveSubKey(key, 'course-abc');
    expect(subKey).toBe('sections/0/lessons/0/video.mp4');
    const path = mediaArchivePath(subKey!);
    expect(path).toBe('media/sections/0/lessons/0/video.mp4');
    expect(subKeyFromMediaPath(path)).toBe(subKey);
    // Réécriture vers un nouveau cours (re-import).
    expect(storageKeyForSubKey('course-xyz', subKey!)).toBe(
      'courses/course-xyz/sections/0/lessons/0/video.mp4',
    );
  });

  it('retourne null si la clé n\'appartient pas au cours', () => {
    expect(masterArchiveSubKey('courses/other/x.png', 'course-abc')).toBeNull();
    expect(subKeyFromMediaPath('manifest.json')).toBeNull();
  });
});
