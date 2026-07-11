import { afterEach, describe, expect, it, vi } from 'vitest';

// Test IDOR (P116 — audit OWASP) : PATCH /api/lessons/[id] retrouve la leçon
// par id SEUL (LessonModel.findById), puis vérifie l'ownership via le cours
// parent (CourseModel.findOne({ _id: lesson.courseId, userId })). Ce test
// verrouille ce second filtre : sans lui, n'importe quel utilisateur connecté
// pourrait éditer le contenu d'une leçon appartenant à un autre utilisateur en
// devinant/énumérant un id de leçon.

const requireApiUserMock = vi.fn();
vi.mock('@/lib/session', () => ({
  requireApiUser: () => requireApiUserMock(),
}));

const lessonFindByIdMock = vi.fn();
const courseFindOneMock = vi.fn();
vi.mock('@sallycourse/db', () => ({
  connectDb: vi.fn().mockResolvedValue(undefined),
  Course: {
    findOne: (...args: unknown[]) => courseFindOneMock(...args),
  },
  Lesson: {
    findById: (...args: unknown[]) => lessonFindByIdMock(...args),
  },
  Section: {
    findById: vi.fn(),
  },
}));

vi.mock('@sallycourse/shared', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    storageKeys: { course: () => ({ lesson: () => ({ article: () => 'k' }) }) },
    uploadObject: vi.fn().mockResolvedValue(undefined),
  };
});

// Import APRÈS les mocks (hoisting vi.mock garanti par vitest).
import { PATCH } from './route';

const OTHER_USERS_LESSON_ID = '507f1f77bcf86cd799439022';
const params = Promise.resolve({ id: OTHER_USERS_LESSON_ID });

function patchRequest(body: unknown): Request {
  return new Request(`http://localhost/api/lessons/${OTHER_USERS_LESSON_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('PATCH /api/lessons/[id] — IDOR', () => {
  it("renvoie 404 quand la leçon existe mais appartient au cours d'un AUTRE utilisateur", async () => {
    requireApiUserMock.mockResolvedValue({ id: 'attacker-user' });
    // La leçon existe bel et bien (id valide, trouvée par findById)...
    lessonFindByIdMock.mockResolvedValue({
      _id: OTHER_USERS_LESSON_ID,
      courseId: 'victim-course-1',
      type: 'article',
      save: vi.fn(),
    });
    // ...mais son cours parent n'appartient PAS à l'attaquant : le filtre
    // ownership {_id: courseId, userId: attacker} ne matche rien.
    courseFindOneMock.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(null) }) });

    const res = await PATCH(patchRequest({ articleMd: '# contenu volé' }), { params });

    expect(res.status).toBe(404);
    const data = (await res.json()) as { error?: string };
    expect(data.error).toBeTruthy();

    // Vérifie que la vérification d'ownership porte bien sur le cours parent + l'attaquant.
    expect(courseFindOneMock).toHaveBeenCalledWith({ _id: 'victim-course-1', userId: 'attacker-user' });
  });

  it('atteint la logique métier (409 leçon non-article) quand le cours appartient bien au demandeur', async () => {
    requireApiUserMock.mockResolvedValue({ id: 'owner-user' });
    lessonFindByIdMock.mockResolvedValue({
      _id: OTHER_USERS_LESSON_ID,
      courseId: 'owner-course-1',
      type: 'video', // pas 'article' → 409 attendu APRÈS le check ownership (preuve qu'on l'a passé)
      save: vi.fn(),
    });
    courseFindOneMock.mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ _id: 'owner-course-1' }) }) });

    const res = await PATCH(patchRequest({ articleMd: '# contenu légitime' }), { params });

    expect(res.status).toBe(409);
  });
});
