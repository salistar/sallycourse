import { afterEach, describe, expect, it, vi } from 'vitest';

// Test de la purge complète du compte (P66, RGPD — droit à l'effacement).
// @sallycourse/db et la session sont entièrement mockés : aucune connexion
// Mongo réelle. On vérifie que TOUTES les collections attendues sont
// nettoyées, dans le bon périmètre (par courseId pour le contenu dérivé, par
// userId pour le reste), et que la confirmation forte (email retapé) est
// bien exigée avant toute suppression.

const requireApiUserMock = vi.fn();
vi.mock('@/lib/session', () => ({
  requireApiUser: () => requireApiUserMock(),
}));

vi.mock('@sallycourse/shared', () => ({
  deleteCoursePrefix: vi.fn().mockResolvedValue(0),
}));

const deleteManyMocks = {
  Section: vi.fn().mockResolvedValue({}),
  Lesson: vi.fn().mockResolvedValue({}),
  Quiz: vi.fn().mockResolvedValue({}),
  GenerationJob: vi.fn().mockResolvedValue({}),
  Deployment: vi.fn().mockResolvedValue({}),
  LmsListing: vi.fn().mockResolvedValue({}),
  CourseAnalytics: vi.fn().mockResolvedValue({}),
  Course: vi.fn().mockResolvedValue({}),
  PlatformCredential: vi.fn().mockResolvedValue({}),
  ApiKey: vi.fn().mockResolvedValue({}),
  Webhook: vi.fn().mockResolvedValue({}),
  Subscription: vi.fn().mockResolvedValue({}),
  Notification: vi.fn().mockResolvedValue({}),
  Enrollment: vi.fn().mockResolvedValue({}),
};

const findByIdMock = vi.fn();
const courseFindMock = vi.fn();
const userDeleteOneMock = vi.fn().mockResolvedValue({});

vi.mock('@sallycourse/db', () => ({
  connectDb: vi.fn().mockResolvedValue(undefined),
  User: {
    findById: (...args: unknown[]) => findByIdMock(...args),
    deleteOne: (...args: unknown[]) => userDeleteOneMock(...args),
  },
  Course: {
    find: (...args: unknown[]) => courseFindMock(...args),
    deleteMany: (...args: unknown[]) => deleteManyMocks.Course(...args),
  },
  Section: { deleteMany: (...args: unknown[]) => deleteManyMocks.Section(...args) },
  Lesson: { deleteMany: (...args: unknown[]) => deleteManyMocks.Lesson(...args) },
  Quiz: { deleteMany: (...args: unknown[]) => deleteManyMocks.Quiz(...args) },
  GenerationJob: { deleteMany: (...args: unknown[]) => deleteManyMocks.GenerationJob(...args) },
  Deployment: { deleteMany: (...args: unknown[]) => deleteManyMocks.Deployment(...args) },
  LmsListing: { deleteMany: (...args: unknown[]) => deleteManyMocks.LmsListing(...args) },
  CourseAnalytics: { deleteMany: (...args: unknown[]) => deleteManyMocks.CourseAnalytics(...args) },
  PlatformCredential: { deleteMany: (...args: unknown[]) => deleteManyMocks.PlatformCredential(...args) },
  ApiKey: { deleteMany: (...args: unknown[]) => deleteManyMocks.ApiKey(...args) },
  Webhook: { deleteMany: (...args: unknown[]) => deleteManyMocks.Webhook(...args) },
  Subscription: { deleteMany: (...args: unknown[]) => deleteManyMocks.Subscription(...args) },
  Notification: { deleteMany: (...args: unknown[]) => deleteManyMocks.Notification(...args) },
  Enrollment: { deleteMany: (...args: unknown[]) => deleteManyMocks.Enrollment(...args) },
}));

// Import APRÈS les mocks (hoisting vi.mock garanti par vitest).
import { POST } from './route';

function mockSessionUser(id = 'user-1') {
  requireApiUserMock.mockResolvedValue({ id, email: 'user@example.com' });
}

function mockDbUser(email: string | null) {
  findByIdMock.mockReturnValue({
    select: () => ({ lean: () => Promise.resolve(email ? { email } : null) }),
  });
}

function mockCourses(ids: string[]) {
  courseFindMock.mockReturnValue({
    select: () => ({ lean: () => Promise.resolve(ids.map((_id) => ({ _id }))) }),
  });
}

function request(body: unknown): Request {
  return new Request('http://localhost/api/account/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/account/delete', () => {
  it('refuse sans authentification', async () => {
    requireApiUserMock.mockResolvedValue(Response.json({ error: 'nope' }, { status: 401 }));
    const res = await POST(request({ confirmEmail: 'user@example.com' }));
    expect(res.status).toBe(401);
    expect(deleteManyMocks.Course).not.toHaveBeenCalled();
  });

  it('refuse une confirmation email incorrecte (aucune suppression déclenchée)', async () => {
    mockSessionUser();
    mockDbUser('user@example.com');
    const res = await POST(request({ confirmEmail: 'mauvais@example.com' }));
    expect(res.status).toBe(400);
    expect(deleteManyMocks.Course).not.toHaveBeenCalled();
    expect(userDeleteOneMock).not.toHaveBeenCalled();
  });

  it('purge toutes les collections attendues avec une confirmation valide', async () => {
    mockSessionUser('user-1');
    mockDbUser('User@Example.com'); // casse différente : comparaison insensible
    mockCourses(['course-1', 'course-2']);

    const res = await POST(request({ confirmEmail: 'user@example.com' }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });

    // Contenu dérivé des cours — filtré par courseId.
    for (const model of [
      'Section',
      'Lesson',
      'Quiz',
      'GenerationJob',
      'Deployment',
      'LmsListing',
      'CourseAnalytics',
    ] as const) {
      expect(deleteManyMocks[model]).toHaveBeenCalledWith({
        courseId: { $in: ['course-1', 'course-2'] },
      });
    }

    // Cours de l'utilisateur.
    expect(deleteManyMocks.Course).toHaveBeenCalledWith({ userId: 'user-1' });

    // Collections rattachées directement à l'utilisateur.
    for (const model of [
      'PlatformCredential',
      'ApiKey',
      'Webhook',
      'Subscription',
      'Notification',
    ] as const) {
      expect(deleteManyMocks[model]).toHaveBeenCalledWith({ userId: 'user-1' });
    }
    expect(deleteManyMocks.Enrollment).toHaveBeenCalledWith({ studentId: 'user-1' });

    // Le compte lui-même, en dernier.
    expect(userDeleteOneMock).toHaveBeenCalledWith({ _id: 'user-1' });
  });

  it('404 si l’utilisateur est déjà introuvable en base', async () => {
    mockSessionUser();
    mockDbUser(null);
    const res = await POST(request({ confirmEmail: 'user@example.com' }));
    expect(res.status).toBe(404);
  });
});
