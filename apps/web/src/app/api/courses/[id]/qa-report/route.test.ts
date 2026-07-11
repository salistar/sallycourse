import { afterEach, describe, expect, it, vi } from 'vitest';

// Test IDOR (P116 — audit OWASP) : un utilisateur authentifié ne doit jamais
// pouvoir lire le rapport QA d'un cours appartenant à un AUTRE utilisateur.
// La route filtre déjà {_id, userId} (voir route.ts) — ce test verrouille le
// comportement (404, pas de fuite de qaReport) contre une régression future.

const requireApiUserMock = vi.fn();
vi.mock('@/lib/session', () => ({
  requireApiUser: () => requireApiUserMock(),
}));

const courseFindOneMock = vi.fn();
vi.mock('@sallycourse/db', () => ({
  connectDb: vi.fn().mockResolvedValue(undefined),
  Course: {
    findOne: (...args: unknown[]) => courseFindOneMock(...args),
  },
}));

// Import APRÈS les mocks (hoisting vi.mock garanti par vitest).
import { GET } from './route';

const OTHER_USERS_COURSE_ID = '507f1f77bcf86cd799439011';
const params = Promise.resolve({ id: OTHER_USERS_COURSE_ID });

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/courses/[id]/qa-report — IDOR', () => {
  it("renvoie 404 (pas 403, pour ne pas confirmer l'existence) quand le cours appartient à un autre utilisateur", async () => {
    requireApiUserMock.mockResolvedValue({ id: 'attacker-user', plan: 'free' });
    // findOne({ _id, userId: 'attacker-user' }) : le cours existe mais pour un
    // AUTRE userId — le filtre ownership doit le rendre introuvable ici.
    courseFindOneMock.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(null) }) });

    const res = await GET(new Request(`http://localhost/api/courses/${OTHER_USERS_COURSE_ID}/qa-report`), {
      params,
    });

    expect(res.status).toBe(404);
    const data = (await res.json()) as { qaReport?: unknown; error?: string };
    expect(data.qaReport).toBeUndefined();
    expect(data.error).toBeTruthy();

    // Vérifie que le filtre appliqué inclut bien l'ownership (pas un simple _id).
    expect(courseFindOneMock).toHaveBeenCalledWith({ _id: OTHER_USERS_COURSE_ID, userId: 'attacker-user' });
  });

  it('renvoie 200 + le rapport QA quand le cours appartient bien au demandeur', async () => {
    requireApiUserMock.mockResolvedValue({ id: 'owner-user', plan: 'free' });
    courseFindOneMock.mockReturnValue({
      select: () => ({
        lean: () => Promise.resolve({ status: 'ready', qaReport: { score: 92 } }),
      }),
    });

    const res = await GET(new Request(`http://localhost/api/courses/${OTHER_USERS_COURSE_ID}/qa-report`), {
      params,
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as { qaReport?: { score: number } };
    expect(data.qaReport?.score).toBe(92);
  });
});
