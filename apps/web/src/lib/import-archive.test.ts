import { describe, expect, it, vi } from 'vitest';
import {
  MASTER_ARCHIVE_FILENAMES,
  MASTER_ARCHIVE_VERSION,
  mediaArchivePath,
  serializeMasterArchiveFiles,
  type MasterArchive,
} from '@sallycourse/shared';
import { buildZip, type ZipEntry } from './simple-zip';
import { contentTypeForKey, rekeyCourseReferences } from './import-archive';

/* ------------------------------------------------------------------ */
/* Tests purs (toujours exécutés)                                      */
/* ------------------------------------------------------------------ */

describe('rekeyCourseReferences', () => {
  it('réécrit récursivement les clés courses/{ancien}/ → courses/{nouveau}/', () => {
    const value = {
      videoUrl: 'courses/OLD/sections/0/lessons/0/video.mp4',
      screenshots: ['courses/OLD/sections/0/lessons/0/screenshots/1.png'],
      nested: { cover: 'courses/OLD/marketing/cover.png', unrelated: 'https://x/y' },
      count: 3,
    };
    const out = rekeyCourseReferences(value, 'OLD', 'NEW');
    expect(out.videoUrl).toBe('courses/NEW/sections/0/lessons/0/video.mp4');
    expect(out.screenshots[0]).toBe('courses/NEW/sections/0/lessons/0/screenshots/1.png');
    expect(out.nested.cover).toBe('courses/NEW/marketing/cover.png');
    expect(out.nested.unrelated).toBe('https://x/y');
    expect(out.count).toBe(3);
  });

  it('NEUTRALISE (null) une clé course-scoped d\'un AUTRE cours — anti cross-tenant (finding 1)', () => {
    // Archive forgée pointant vers le cours d'un tiers : la clé ne doit JAMAIS
    // être stockée verbatim (elle serait présignée et lirait l'objet d'autrui).
    expect(rekeyCourseReferences('courses/VICTIM/sections/0/lessons/0/video.mp4', 'OLD', 'NEW')).toBeNull();
    const forged = {
      videoUrl: 'courses/VICTIM/sections/0/lessons/0/video.mp4',
      cover: 'courses/OLD/marketing/cover.png',
      external: 'https://cdn/x.png',
    };
    const out = rekeyCourseReferences(forged, 'OLD', 'NEW');
    expect(out.videoUrl).toBeNull(); // clé forgée neutralisée
    expect(out.cover).toBe('courses/NEW/marketing/cover.png'); // clé légitime réécrite
    expect(out.external).toBe('https://cdn/x.png'); // non course-scoped, inchangée
  });
});

describe('contentTypeForKey', () => {
  it('déduit le type MIME depuis l\'extension', () => {
    expect(contentTypeForKey('sections/0/lessons/0/video.mp4')).toBe('video/mp4');
    expect(contentTypeForKey('a/b/audio.mp3')).toBe('audio/mpeg');
    expect(contentTypeForKey('marketing/cover.png')).toBe('image/png');
    expect(contentTypeForKey('x/article.md')).toContain('text/markdown');
    expect(contentTypeForKey('x/unknown.bin')).toBe('application/octet-stream');
  });
});

/* ------------------------------------------------------------------ */
/* Intégration MongoDB (guardée — skippée sans mongodb-memory-server)  */
/* ------------------------------------------------------------------ */

// Stub du ré-upload S3 (aucun stockage réel) — on capture les clés produites.
const uploaded: { key: string; contentType: string }[] = [];
vi.mock('@sallycourse/shared', async () => {
  const actual = await vi.importActual<typeof import('@sallycourse/shared')>('@sallycourse/shared');
  return {
    ...actual,
    uploadObject: vi.fn(async (key: string, _body: unknown, contentType: string) => {
      uploaded.push({ key, contentType });
    }),
  };
});

interface MemoryServerModule {
  MongoMemoryServer: { create(): Promise<{ getUri(): string; stop(): Promise<void> }> };
}
async function loadMemoryServer(): Promise<MemoryServerModule | null> {
  const specifier = 'mongodb-memory-server';
  try {
    return (await import(/* @vite-ignore */ specifier)) as unknown as MemoryServerModule;
  } catch {
    return null;
  }
}

/** Construit une archive maître (buffer ZIP) de test avec 1 section, 2 leçons, 1 quiz, 1 média. */
function buildTestArchiveZip(oldCourseId: string): Buffer {
  const videoSubKey = 'sections/0/lessons/0/video.mp4';
  const archive: MasterArchive = {
    manifest: {
      version: MASTER_ARCHIVE_VERSION,
      courseId: oldCourseId,
      exportedAt: '2026-07-15T00:00:00.000Z',
      structure: { sections: 1, lessons: 2, quizzes: 1 },
      media: [{ subKey: videoSubKey, path: mediaArchivePath(videoSubKey) }],
    },
    course: {
      title: 'Cours ré-importé',
      difficulty: 'beginner',
      locale: 'fr',
      watermark: false,
      outline: null,
      marketing: { assets: { udemyCover: `courses/${oldCourseId}/marketing/cover.png` } },
      aiDisclosureAccepted: true,
    },
    sections: [{ order: 0, title: 'Introduction' }],
    lessons: [
      {
        sectionOrder: 0,
        order: 0,
        title: 'Vidéo intro',
        type: 'video',
        status: 'ready',
        script: { slides: [{ template: 'title', narration: 'Bonjour' }] },
        assets: { videoUrl: `courses/${oldCourseId}/${videoSubKey}`, screenshots: [], slides: [] },
      },
      {
        sectionOrder: 0,
        order: 1,
        title: 'Article',
        type: 'article',
        status: 'ready',
        assets: { articleMd: `courses/${oldCourseId}/sections/0/lessons/1/article.md`, screenshots: [], slides: [] },
      },
    ],
    quizzes: [
      {
        sectionOrder: 0,
        lessonOrder: 1,
        questions: [
          { question: 'Q ?', choices: ['a', 'b', 'c', 'd'], correctIndex: 2, explanation: 'car…', difficulty: 'beginner' },
        ],
      },
    ],
  };

  const jsonFiles = serializeMasterArchiveFiles(archive);
  const zipEntries: ZipEntry[] = Object.entries(jsonFiles).map(([name, data]) => ({ name, data }));
  zipEntries.push({ name: MASTER_ARCHIVE_FILENAMES.readme, data: '# doc' });
  zipEntries.push({ name: mediaArchivePath(videoSubKey), data: Buffer.from([1, 2, 3, 4]) });
  return buildZip(zipEntries);
}

describe('createCourseFromArchive — intégration MongoDB réelle', () => {
  it('re-crée le cours + sections/leçons/quiz (script préservé) et ré-uploade les médias au nouvel id', async () => {
    const mms = await loadMemoryServer();
    if (!mms) {
      // mongodb-memory-server absent : suite guardée (voir create-course.integration.test.ts).
      expect(true).toBe(true);
      return;
    }

    const mongod = await mms.MongoMemoryServer.create();
    process.env.MONGO_URI = mongod.getUri();
    uploaded.length = 0;

    const db = await import('@sallycourse/db');
    const { createCourseFromArchive } = await import('./import-archive');
    const mongoose = (await import('mongoose')).default;

    try {
      const user = await db.User.create({ email: 'imp@test.dev', passwordHash: 'x', name: 'Imp' });
      const oldId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
      const zip = buildTestArchiveZip(oldId);

      const result = await createCourseFromArchive(user._id.toString(), zip);

      expect(result.sections).toBe(1);
      expect(result.lessons).toBe(2);
      expect(result.quizzes).toBe(1);
      expect(result.media).toBe(1);
      expect(result.mediaMissing).toBe(0);

      const newId = result.id;
      const lessons = await db.Lesson.find({ courseId: newId }).sort({ order: 1 }).lean();
      expect(lessons).toHaveLength(2);
      // Le script est bien restauré.
      expect(lessons[0]!.script).toEqual({ slides: [{ template: 'title', narration: 'Bonjour' }] });
      // Les clés d'assets pointent vers le NOUVEAU cours.
      expect((lessons[0]!.assets as { videoUrl?: string }).videoUrl).toBe(
        `courses/${newId}/sections/0/lessons/0/video.mp4`,
      );

      const quizzes = await db.Quiz.find({ courseId: newId }).lean();
      expect(quizzes).toHaveLength(1);
      expect(quizzes[0]!.questions[0]!.correctIndex).toBe(2);

      // Média ré-uploadé sous la clé du nouveau cours.
      expect(uploaded).toContainEqual({
        key: `courses/${newId}/sections/0/lessons/0/video.mp4`,
        contentType: 'video/mp4',
      });

      const course = await db.Course.findById(newId).lean();
      expect((course!.marketing as { assets?: { udemyCover?: string } }).assets?.udemyCover).toBe(
        `courses/${newId}/marketing/cover.png`,
      );
    } finally {
      await mongoose.disconnect();
      await mongod.stop();
    }
  }, 60_000);
});
