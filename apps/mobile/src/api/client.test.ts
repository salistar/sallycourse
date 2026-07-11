import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  buildAuthHeaders,
  buildUrl,
  looksLikeApiKey,
  SallyCourseClient,
} from './client';

/** Construit une Response mock minimale (assez pour handleJsonResponse). */
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('buildUrl', () => {
  it('joint base et chemin sans double slash', () => {
    expect(buildUrl('https://app.sallycourse.com/', '/api/v1/courses')).toBe(
      'https://app.sallycourse.com/api/v1/courses',
    );
  });

  it('ajoute le slash manquant', () => {
    expect(buildUrl('https://app.sallycourse.com', 'api/v1/courses')).toBe(
      'https://app.sallycourse.com/api/v1/courses',
    );
  });
});

describe('buildAuthHeaders', () => {
  it('construit un en-tête Bearer', () => {
    expect(buildAuthHeaders('sk_test_123')).toEqual({
      Authorization: 'Bearer sk_test_123',
      'Content-Type': 'application/json',
    });
  });
});

describe('looksLikeApiKey', () => {
  it('accepte une clé de longueur suffisante', () => {
    expect(looksLikeApiKey('sk_1234567890')).toBe(true);
  });

  it('rejette une chaîne trop courte', () => {
    expect(looksLikeApiKey('sk_1')).toBe(false);
  });

  it('rejette une valeur vide', () => {
    expect(looksLikeApiKey('')).toBe(false);
  });
});

describe('SallyCourseClient.listCourses', () => {
  it('appelle GET /api/v1/courses avec le Bearer et retourne la liste', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://app.sallycourse.com/api/v1/courses');
      expect(init?.method).toBe('GET');
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sk_abc');
      return jsonResponse(200, {
        courses: [
          {
            id: 'c1',
            title: 'Intro TypeScript',
            difficulty: 'beginner',
            status: 'ready',
            locale: 'fr',
            platforms: ['udemy'],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
          },
        ],
      });
    });

    const client = new SallyCourseClient({
      baseUrl: 'https://app.sallycourse.com',
      apiKey: 'sk_abc',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const courses = await client.listCourses();
    expect(courses).toHaveLength(1);
    expect(courses[0].title).toBe('Intro TypeScript');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('lève une ApiError avec le code renvoyé par le serveur en cas d’échec', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(401, { error: 'Clé API manquante ou invalide.', code: 'unauthorized' }),
    );

    const client = new SallyCourseClient({
      baseUrl: 'https://app.sallycourse.com',
      apiKey: 'sk_bad',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.listCourses()).rejects.toMatchObject({
      status: 401,
      code: 'unauthorized',
    });
  });
});

describe('SallyCourseClient.getCourse', () => {
  it('appelle GET /api/v1/courses/:id et retourne le détail avec progression', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe('https://app.sallycourse.com/api/v1/courses/c1');
      return jsonResponse(200, {
        id: 'c1',
        title: 'Intro TypeScript',
        difficulty: 'beginner',
        status: 'generating',
        locale: 'fr',
        platforms: ['udemy'],
        generation: { step: 'video', progress: 42 },
        deployments: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      });
    });

    const client = new SallyCourseClient({
      baseUrl: 'https://app.sallycourse.com',
      apiKey: 'sk_abc',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const course = await client.getCourse('c1');
    expect(course.generation).toEqual({ step: 'video', progress: 42 });
  });
});

describe('SallyCourseClient.listNotifications', () => {
  it('appelle GET /api/notifications et retourne le compteur de non-lus', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe('https://app.sallycourse.com/api/notifications');
      return jsonResponse(200, {
        unreadCount: 2,
        notifications: [
          {
            id: 'n1',
            type: 'course_ready',
            title: 'Cours prêt',
            body: 'Votre cours est prêt.',
            read: false,
            link: '/dashboard/courses/c1',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      });
    });

    const client = new SallyCourseClient({
      baseUrl: 'https://app.sallycourse.com',
      apiKey: 'sk_abc',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const res = await client.listNotifications();
    expect(res.unreadCount).toBe(2);
    expect(res.notifications[0].title).toBe('Cours prêt');
  });
});

describe('SallyCourseClient.verifyCredentials', () => {
  it('retourne true si la liste des cours répond correctement', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { courses: [] }));
    const client = new SallyCourseClient({
      baseUrl: 'https://app.sallycourse.com',
      apiKey: 'sk_abc',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await client.verifyCredentials()).toBe(true);
  });

  it('retourne false sur 401 sans relancer l’erreur', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, { error: 'nope', code: 'unauthorized' }));
    const client = new SallyCourseClient({
      baseUrl: 'https://app.sallycourse.com',
      apiKey: 'sk_bad',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await client.verifyCredentials()).toBe(false);
  });

  it('relance les autres erreurs (ex: 500)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, { error: 'boom' }));
    const client = new SallyCourseClient({
      baseUrl: 'https://app.sallycourse.com',
      apiKey: 'sk_abc',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.verifyCredentials()).rejects.toBeInstanceOf(ApiError);
  });
});
