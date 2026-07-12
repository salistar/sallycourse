import { afterEach, describe, expect, it, vi } from 'vitest';

// Tests de POST /api/lms/lessons/[id]/more-exercises (Prompt 145) : rate limit,
// exigence de réponses ratées préalables, et génération mockée (callClaudeJson-like)
// via generatePersonalizedExercises. Aucune connexion Mongo/Redis réelle.

const requireApiUserMock = vi.fn();
vi.mock('@/lib/session', () => ({
  requireApiUser: () => requireApiUserMock(),
}));

const rateLimitMock = vi.fn();
vi.mock('@/lib/rate-limit', () => ({
  extractClientIp: () => '198.51.100.7',
  rateLimit: (...args: unknown[]) => rateLimitMock(...args),
}));

const lessonFindByIdMock = vi.fn();
const progressFindOneMock = vi.fn();
const courseFindByIdMock = vi.fn();
const exerciseCreateMock = vi.fn();
vi.mock('@sallycourse/db', () => ({
  connectDb: vi.fn().mockResolvedValue(undefined),
  Lesson: { findById: (...args: unknown[]) => lessonFindByIdMock(...args) },
  LessonProgress: { findOne: (...args: unknown[]) => progressFindOneMock(...args) },
  Course: { findById: (...args: unknown[]) => courseFindByIdMock(...args) },
  PersonalizedExercise: { create: (...args: unknown[]) => exerciseCreateMock(...args) },
}));

const generateMock = vi.fn();
vi.mock('@/lib/exercise-generator', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    generatePersonalizedExercises: (...args: unknown[]) => generateMock(...args),
  };
});

// Import APRÈS les mocks (hoisting vi.mock garanti par vitest).
import { POST } from './route';

const LESSON_ID = '507f1f77bcf86cd799439011';
const params = Promise.resolve({ id: LESSON_ID });

function postRequest(): Request {
  return new Request(`http://localhost/api/lms/lessons/${LESSON_ID}/more-exercises`, { method: 'POST' });
}

function leanChain(value: unknown) {
  return { select: () => ({ lean: () => Promise.resolve(value) }) };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/lms/lessons/[id]/more-exercises', () => {
  it('exige une authentification', async () => {
    requireApiUserMock.mockResolvedValue(new Response('unauth', { status: 401 }));
    const res = await POST(postRequest(), { params });
    expect(res.status).toBe(401);
  });

  it('refuse au-delà de la limite de rate limit (429 + Retry-After)', async () => {
    requireApiUserMock.mockResolvedValue({ id: 'student-1' });
    rateLimitMock.mockResolvedValue({ allowed: false, remaining: 0, resetAt: new Date(Date.now() + 60_000) });

    const res = await POST(postRequest(), { params });

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect(lessonFindByIdMock).not.toHaveBeenCalled();
  });

  it('404 si la leçon est introuvable', async () => {
    requireApiUserMock.mockResolvedValue({ id: 'student-1' });
    rateLimitMock.mockResolvedValue({ allowed: true, remaining: 4, resetAt: new Date() });
    lessonFindByIdMock.mockReturnValue(leanChain(null));

    const res = await POST(postRequest(), { params });
    expect(res.status).toBe(404);
  });

  it('409 si la leçon n’est pas de type quiz', async () => {
    requireApiUserMock.mockResolvedValue({ id: 'student-1' });
    rateLimitMock.mockResolvedValue({ allowed: true, remaining: 4, resetAt: new Date() });
    lessonFindByIdMock.mockReturnValue(
      leanChain({ _id: LESSON_ID, courseId: 'course-1', title: 'Leçon vidéo', type: 'video' }),
    );

    const res = await POST(postRequest(), { params });
    expect(res.status).toBe(409);
  });

  it('400 si aucune réponse ratée n’est enregistrée', async () => {
    requireApiUserMock.mockResolvedValue({ id: 'student-1' });
    rateLimitMock.mockResolvedValue({ allowed: true, remaining: 4, resetAt: new Date() });
    lessonFindByIdMock.mockReturnValue(
      leanChain({ _id: LESSON_ID, courseId: 'course-1', title: 'Quiz — Boucles', type: 'quiz' }),
    );
    progressFindOneMock.mockReturnValue(leanChain({ wrongAnswers: [], courseId: 'course-1' }));

    const res = await POST(postRequest(), { params });

    expect(res.status).toBe(400);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('génère les exercices ciblés sur les thèmes faibles et les persiste séparément du quiz officiel', async () => {
    requireApiUserMock.mockResolvedValue({ id: 'student-1' });
    rateLimitMock.mockResolvedValue({ allowed: true, remaining: 4, resetAt: new Date() });
    lessonFindByIdMock.mockReturnValue(
      leanChain({ _id: LESSON_ID, courseId: 'course-1', title: 'Quiz — Boucles', type: 'quiz' }),
    );
    progressFindOneMock.mockReturnValue(
      leanChain({
        courseId: 'course-1',
        wrongAnswers: [
          { question: 'Que fait range(5) ?', theme: 'boucles for', pickedIndex: 1, correctIndex: 0 },
          { question: 'Syntaxe while ?', theme: 'boucles while', pickedIndex: 2, correctIndex: 1 },
        ],
      }),
    );
    courseFindByIdMock.mockReturnValue(leanChain({ title: 'Python pour débutants', locale: 'fr' }));

    const generatedQuestions = [
      {
        question: 'Nouvelle question 1',
        choices: ['A', 'B', 'C', 'D'],
        correctIndex: 0,
        explanation: 'Explication détaillée.',
        difficulty: 'beginner',
      },
      {
        question: 'Nouvelle question 2',
        choices: ['A', 'B', 'C', 'D'],
        correctIndex: 1,
        explanation: 'Explication détaillée.',
        difficulty: 'intermediate',
      },
      {
        question: 'Nouvelle question 3',
        choices: ['A', 'B', 'C', 'D'],
        correctIndex: 2,
        explanation: 'Explication détaillée.',
        difficulty: 'beginner',
      },
    ];
    generateMock.mockResolvedValue(generatedQuestions);
    exerciseCreateMock.mockResolvedValue({ _id: 'exercise-1' });

    const res = await POST(postRequest(), { params });

    expect(res.status).toBe(200);
    const data = (await res.json()) as { id: string; targetedThemes: string[]; questions: unknown[] };
    expect(data.targetedThemes).toEqual(['boucles for', 'boucles while']);
    expect(data.questions).toHaveLength(3);

    // Persistance séparée du Quiz officiel : PersonalizedExercise.create, jamais Quiz.updateOne.
    expect(exerciseCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        studentId: 'student-1',
        lessonId: LESSON_ID,
        courseId: 'course-1',
        targetedThemes: ['boucles for', 'boucles while'],
        questions: generatedQuestions,
      }),
    );
  });

  it('502 si la génération échoue techniquement', async () => {
    requireApiUserMock.mockResolvedValue({ id: 'student-1' });
    rateLimitMock.mockResolvedValue({ allowed: true, remaining: 4, resetAt: new Date() });
    lessonFindByIdMock.mockReturnValue(
      leanChain({ _id: LESSON_ID, courseId: 'course-1', title: 'Quiz — Boucles', type: 'quiz' }),
    );
    progressFindOneMock.mockReturnValue(
      leanChain({
        courseId: 'course-1',
        wrongAnswers: [{ question: 'Q1', theme: 'boucles', pickedIndex: 1, correctIndex: 0 }],
      }),
    );
    courseFindByIdMock.mockReturnValue(leanChain({ title: 'Python', locale: 'fr' }));
    generateMock.mockRejectedValue(new Error('Échec Claude'));

    const res = await POST(postRequest(), { params });
    expect(res.status).toBe(502);
    expect(exerciseCreateMock).not.toHaveBeenCalled();
  });
});
