import { afterEach, describe, expect, it, vi } from 'vitest';

// Tests de POST /api/lms/courses/[id]/ask (Prompt 146) : auth, rate limit,
// exigence d'inscription (ownership), et génération mockée (answerCourseQuestion).
// Aucune connexion Mongo/Redis réelle.

const requireApiUserMock = vi.fn();
vi.mock('@/lib/session', () => ({
  requireApiUser: () => requireApiUserMock(),
}));

const rateLimitMock = vi.fn();
vi.mock('@/lib/rate-limit', () => ({
  extractClientIp: () => '198.51.100.7',
  rateLimit: (...args: unknown[]) => rateLimitMock(...args),
}));

const enrollmentFindOneMock = vi.fn();
const courseFindByIdMock = vi.fn();
const lessonFindMock = vi.fn();
vi.mock('@sallycourse/db', () => ({
  connectDb: vi.fn().mockResolvedValue(undefined),
  Enrollment: { findOne: (...args: unknown[]) => enrollmentFindOneMock(...args) },
  Course: { findById: (...args: unknown[]) => courseFindByIdMock(...args) },
  Lesson: { find: (...args: unknown[]) => lessonFindMock(...args) },
}));

const answerMock = vi.fn();
vi.mock('@/lib/course-chatbot', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    answerCourseQuestion: (...args: unknown[]) => answerMock(...args),
  };
});

// Import APRÈS les mocks (hoisting vi.mock garanti par vitest).
import { POST } from './route';

const COURSE_ID = '507f1f77bcf86cd799439011';
const params = Promise.resolve({ id: COURSE_ID });

function postRequest(body: unknown): Request {
  return new Request(`http://localhost/api/lms/courses/${COURSE_ID}/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function leanChain(value: unknown) {
  return { select: () => ({ lean: () => Promise.resolve(value) }) };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/lms/courses/[id]/ask', () => {
  it('exige une authentification', async () => {
    requireApiUserMock.mockResolvedValue(new Response('unauth', { status: 401 }));
    const res = await POST(postRequest({ question: 'Comment fonctionne React ?' }), { params });
    expect(res.status).toBe(401);
  });

  it('400 si la question est invalide (trop courte)', async () => {
    requireApiUserMock.mockResolvedValue({ id: 'student-1' });
    const res = await POST(postRequest({ question: 'ok' }), { params });
    expect(res.status).toBe(400);
  });

  it('refuse au-delà de la limite de rate limit (429 + Retry-After)', async () => {
    requireApiUserMock.mockResolvedValue({ id: 'student-1' });
    rateLimitMock.mockResolvedValue({ allowed: false, remaining: 0, resetAt: new Date(Date.now() + 60_000) });

    const res = await POST(postRequest({ question: 'Comment fonctionne React ?' }), { params });

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect(enrollmentFindOneMock).not.toHaveBeenCalled();
  });

  it('403 si l’étudiant n’est pas inscrit au cours', async () => {
    requireApiUserMock.mockResolvedValue({ id: 'student-1' });
    rateLimitMock.mockResolvedValue({ allowed: true, remaining: 10, resetAt: new Date() });
    enrollmentFindOneMock.mockReturnValue(leanChain(null));

    const res = await POST(postRequest({ question: 'Comment fonctionne React ?' }), { params });
    expect(res.status).toBe(403);
    expect(answerMock).not.toHaveBeenCalled();
  });

  it('404 si le cours est introuvable', async () => {
    requireApiUserMock.mockResolvedValue({ id: 'student-1' });
    rateLimitMock.mockResolvedValue({ allowed: true, remaining: 10, resetAt: new Date() });
    enrollmentFindOneMock.mockReturnValue(leanChain({ _id: 'enr-1' }));
    courseFindByIdMock.mockReturnValue(leanChain(null));

    const res = await POST(postRequest({ question: 'Comment fonctionne React ?' }), { params });
    expect(res.status).toBe(404);
  });

  it('répond avec la réponse sourcée sur une question valide', async () => {
    requireApiUserMock.mockResolvedValue({ id: 'student-1' });
    rateLimitMock.mockResolvedValue({ allowed: true, remaining: 10, resetAt: new Date() });
    enrollmentFindOneMock.mockReturnValue(leanChain({ _id: 'enr-1' }));
    courseFindByIdMock.mockReturnValue(leanChain({ title: 'React avancé', locale: 'fr' }));
    lessonFindMock.mockReturnValue(leanChain([
      { _id: 'lesson-react', title: 'Introduction à React', type: 'video', script: { slides: [] }, assets: {} },
    ]));
    answerMock.mockResolvedValue({ answer: 'React utilise un DOM virtuel.', sourceLessonIds: ['lesson-react'] });

    const res = await POST(postRequest({ question: 'Comment fonctionne le DOM virtuel de React ?' }), { params });

    expect(res.status).toBe(200);
    const data = (await res.json()) as { answer: string; sourceLessonIds: string[] };
    expect(data.answer).toBe('React utilise un DOM virtuel.');
    expect(data.sourceLessonIds).toEqual(['lesson-react']);
  });

  it('502 si la génération échoue techniquement', async () => {
    requireApiUserMock.mockResolvedValue({ id: 'student-1' });
    rateLimitMock.mockResolvedValue({ allowed: true, remaining: 10, resetAt: new Date() });
    enrollmentFindOneMock.mockReturnValue(leanChain({ _id: 'enr-1' }));
    courseFindByIdMock.mockReturnValue(leanChain({ title: 'React avancé', locale: 'fr' }));
    lessonFindMock.mockReturnValue(leanChain([]));
    answerMock.mockRejectedValue(new Error('Échec Claude'));

    const res = await POST(postRequest({ question: 'Comment fonctionne React ?' }), { params });
    expect(res.status).toBe(502);
  });
});
