// Test de non-régression du pack export ZIP (Prompt 127) : golden-file de
// STRUCTURE (pas de contenu binaire exact) pour processPackaging — le format
// d'export le plus ancien du repo (Prompt 30) n'avait encore aucun test
// contrairement à SCORM/Common Cartridge. On mocke Mongo (Course/Section/
// Lesson/Quiz), le stockage S3 (uploadObject capture le flux au lieu de
// l'envoyer) et le navigateur de rendu PDF (absent en CI) ; on vérifie
// ensuite les noms d'entrées du ZIP produit via les en-têtes locaux du
// binaire (PK\x03\x04), sans lib de dézippage.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Readable } from 'node:stream';

const mockCourseFindById = vi.hoisted(() => vi.fn());
const mockSectionFind = vi.hoisted(() => vi.fn());
const mockLessonFind = vi.hoisted(() => vi.fn());
const mockQuizFind = vi.hoisted(() => vi.fn());
const mockUploadObject = vi.hoisted(() => vi.fn());
const mockGetObjectStream = vi.hoisted(() => vi.fn());
const mockObjectExists = vi.hoisted(() => vi.fn());
const mockPublishProgress = vi.hoisted(() =>
  vi.fn(async (_conn: unknown, _payload: { progress: number }) => undefined),
);

vi.mock('../shared.js', async () => {
  const actual = await vi.importActual<typeof import('../shared.js')>('../shared.js');
  return {
    ...actual,
    Course: { findById: mockCourseFindById },
    Section: { find: mockSectionFind },
    Lesson: { find: mockLessonFind },
    Quiz: { find: mockQuizFind },
    uploadObject: mockUploadObject,
    getObjectStream: mockGetObjectStream,
    objectExists: mockObjectExists,
    publishProgress: mockPublishProgress,
  };
});

vi.mock('../queues/connection.js', () => ({
  getRedisConnection: vi.fn(() => ({})),
}));

vi.mock('../media/slide-renderer.js', () => ({
  // Aucun navigateur en environnement de test : le rendu PDF des solutions
  // échoue et doit être omis du pack SANS faire tomber processPackaging
  // (comportement déjà géré par un try/catch dans packaging.ts).
  getSlideBrowser: vi.fn(async () => {
    throw new Error('navigateur indisponible en test');
  }),
}));

import { processPackaging } from './packaging.js';

/** Extrait les noms de fichiers déclarés dans les en-têtes locaux d'un ZIP (PK\x03\x04). */
function listZipEntryNames(buf: Buffer): string[] {
  const names: string[] = [];
  const sig = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  let offset = 0;
  while (offset < buf.length) {
    const idx = buf.indexOf(sig, offset);
    if (idx === -1) break;
    const nameLen = buf.readUInt16LE(idx + 26);
    const nameStart = idx + 30;
    const name = buf.toString('utf-8', nameStart, nameStart + nameLen);
    names.push(name);
    offset = nameStart + nameLen;
  }
  return names;
}

/** Convertit un Readable en Buffer complet (pour capturer le flux uploadé). */
async function drain(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

function objectId(id: string) {
  return { toString: () => id };
}

describe('processPackaging — structure du ZIP produit (golden-file)', () => {
  beforeEach(() => {
    mockCourseFindById.mockReset();
    mockSectionFind.mockReset();
    mockLessonFind.mockReset();
    mockQuizFind.mockReset();
    mockUploadObject.mockReset();
    mockGetObjectStream.mockReset();
    mockObjectExists.mockReset();
    mockPublishProgress.mockClear();
  });

  it('empaquette sections/leçons/quiz/marketing avec l’arborescence attendue', async () => {
    const courseId = 'course-abc123';

    mockCourseFindById.mockResolvedValue({
      _id: objectId(courseId),
      locale: 'fr',
      title: 'Cours de Démo & Test',
      marketing: {
        content: { udemyDescription: 'Description SEO du cours.' },
        assets: {},
      },
      coverImageUrl: undefined,
    });

    const sections = [
      { _id: objectId('sec0'), courseId: objectId(courseId), order: 0, title: 'Introduction' },
      { _id: objectId('sec1'), courseId: objectId(courseId), order: 1, title: 'Approfondissement' },
    ];
    mockSectionFind.mockReturnValue({
      sort: vi.fn().mockResolvedValue(sections),
    });

    const lessons = [
      {
        _id: objectId('l0'),
        sectionId: objectId('sec0'),
        order: 0,
        title: 'Bienvenue',
        type: 'article',
        assets: {},
      },
      {
        _id: objectId('l1'),
        sectionId: objectId('sec0'),
        order: 1,
        title: 'Démo vidéo',
        type: 'video',
        assets: {},
      },
      {
        _id: objectId('l2'),
        sectionId: objectId('sec1'),
        order: 0,
        title: 'Aller plus loin',
        type: 'article',
        assets: {},
      },
    ];
    mockLessonFind.mockReturnValue({
      sort: vi.fn().mockResolvedValue(lessons),
    });

    const quizzes = [
      {
        _id: objectId('q0'),
        sectionId: objectId('sec0'),
        questions: [
          {
            question: 'Question 1 ?',
            choices: ['A', 'B', 'C', 'D'],
            correctIndex: 2,
            explanation: 'Parce que.',
            difficulty: 'beginner',
          },
        ],
      },
    ];
    mockQuizFind.mockResolvedValue(quizzes);

    // Vidéo présente pour la leçon vidéo, article Markdown présent pour les
    // leçons article ; tout le reste (sous-titres, cover) est absent.
    mockObjectExists.mockImplementation(async (key: string) => key.includes('video.mp4'));
    mockGetObjectStream.mockImplementation(async (key: string) => {
      const { Readable } = await import('node:stream');
      if (key.includes('video.mp4')) return Readable.from([Buffer.from('fake-video-bytes')]);
      return Readable.from([Buffer.from('# Titre\n\nUn paragraphe.')]);
    });

    let capturedZip: Buffer | undefined;
    mockUploadObject.mockImplementation(async (_key: string, stream: Readable) => {
      capturedZip = await drain(stream);
      return { key: _key };
    });

    const result = await processPackaging({ data: { courseId } } as never);

    expect(result.courseId).toBe(courseId);
    expect(result.zipKey).toContain('course-abc123');
    expect(result.zipKey).toContain('course-pack.zip');
    // 2 leçons article + 1 leçon vidéo (readTextObject pour l'article de la
    // vidéo n'est pas appelé) → mediaLessons compte article+vidéo présents.
    expect(result.lessons).toBe(3);
    expect(result.quizzes).toBe(1);

    expect(capturedZip).toBeDefined();
    // Signature ZIP locale en tête d'archive.
    expect(capturedZip!.subarray(0, 4).toString('hex')).toBe('504b0304');

    const names = listZipEntryNames(capturedZip!);
    // Arborescence par section (NN-slug/NN-slug-lecon.ext).
    expect(names).toContain('01-introduction/01-bienvenue.html');
    expect(names).toContain('01-introduction/02-demo-video.mp4');
    expect(names).toContain('02-approfondissement/01-aller-plus-loin.html');
    // Quiz de section en CSV Udemy bulk.
    expect(names).toContain('quiz/01-introduction.csv');
    // Marketing : description présente ; cover absente (aucune clé fournie).
    expect(names).toContain('marketing/description.txt');
    expect(names.some((n) => n.startsWith('marketing/cover-'))).toBe(false);
    // PDF des solutions omis (navigateur indisponible) — pack non cassé pour autant.
    expect(names).not.toContain('quiz-solutions.pdf');

    // La progression a bien été publiée jusqu'à 100 (best-effort, non bloquant).
    const lastCall = mockPublishProgress.mock.calls.at(-1)?.[1] as { progress: number } | undefined;
    expect(lastCall?.progress).toBe(100);
  });
});
