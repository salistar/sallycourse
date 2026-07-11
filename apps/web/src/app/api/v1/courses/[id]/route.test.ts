import { afterEach, describe, expect, it, vi } from 'vitest';

// Test IDOR (P116 — audit OWASP) : GET /api/v1/courses/[id] (API publique
// authentifiée par clé API) ne doit jamais renvoyer le cours d'un AUTRE
// porteur de clé, même avec un id de cours valide et existant.

const requireApiKeyUserMock = vi.fn();
vi.mock('@/lib/api-auth', () => ({
  requireApiKeyUser: (...args: unknown[]) => requireApiKeyUserMock(...args),
}));

const courseFindOneMock = vi.fn();
const generationJobFindOneMock = vi.fn();
const deploymentFindMock = vi.fn();
vi.mock('@sallycourse/db', () => ({
  connectDb: vi.fn().mockResolvedValue(undefined),
  Course: {
    findOne: (...args: unknown[]) => courseFindOneMock(...args),
  },
  GenerationJob: {
    findOne: (...args: unknown[]) => generationJobFindOneMock(...args),
  },
  Deployment: {
    find: (...args: unknown[]) => deploymentFindMock(...args),
  },
}));

// Import APRÈS les mocks (hoisting vi.mock garanti par vitest).
import { GET } from './route';

const OTHER_TENANTS_COURSE_ID = '507f1f77bcf86cd799439033';
const params = Promise.resolve({ id: OTHER_TENANTS_COURSE_ID });

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/v1/courses/[id] — IDOR (auth par clé API)', () => {
  it("renvoie 404 quand le cours appartient au tenant d'une AUTRE clé API", async () => {
    requireApiKeyUserMock.mockResolvedValue({ userId: 'attacker-tenant' });
    // findOne({ _id, userId: 'attacker-tenant' }) : cours existant mais pour un
    // autre tenant — le filtre ownership le rend introuvable.
    courseFindOneMock.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(null) }) });

    const res = await GET(new Request(`http://localhost/api/v1/courses/${OTHER_TENANTS_COURSE_ID}`), { params });

    expect(res.status).toBe(404);
    const data = (await res.json()) as { title?: string; error?: string };
    expect(data.title).toBeUndefined();
    expect(data.error).toBeTruthy();

    expect(courseFindOneMock).toHaveBeenCalledWith({ _id: OTHER_TENANTS_COURSE_ID, userId: 'attacker-tenant' });
    // Aucune requête annexe (job/déploiements) ne doit être tentée après un ownership négatif.
    expect(generationJobFindOneMock).not.toHaveBeenCalled();
    expect(deploymentFindMock).not.toHaveBeenCalled();
  });

  it('renvoie 200 + le détail quand le cours appartient bien au tenant de la clé', async () => {
    requireApiKeyUserMock.mockResolvedValue({ userId: 'owner-tenant' });
    courseFindOneMock.mockReturnValue({
      select: () => ({
        lean: () =>
          Promise.resolve({
            _id: OTHER_TENANTS_COURSE_ID,
            title: 'Cours légitime',
            status: 'ready',
            difficulty: 'beginner',
            locale: 'fr',
            targetPlatforms: ['udemy'],
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
      }),
    });
    generationJobFindOneMock.mockReturnValue({
      select: () => ({ sort: () => ({ lean: () => Promise.resolve(null) }) }),
    });
    deploymentFindMock.mockReturnValue({ select: () => ({ lean: () => Promise.resolve([]) }) });

    const res = await GET(new Request(`http://localhost/api/v1/courses/${OTHER_TENANTS_COURSE_ID}`), { params });

    expect(res.status).toBe(200);
    const data = (await res.json()) as { title?: string };
    expect(data.title).toBe('Cours légitime');
  });
});
