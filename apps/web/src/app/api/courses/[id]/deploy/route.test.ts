import { afterEach, describe, expect, it, vi } from 'vitest';

// Test du gate « mention IA générée » (P66, conformité Udemy) sur la route de
// déploiement : udemy doit être bloqué tant que Course.aiDisclosureAccepted
// est false ; les autres plateformes ne sont jamais concernées par ce gate.
// Toute la couche infra (DB, queue) est mockée — aucune connexion réelle.

const requireApiUserMock = vi.fn();
vi.mock('@/lib/session', () => ({
  requireApiUser: () => requireApiUserMock(),
}));

const courseFindOneMock = vi.fn();
const deploymentFindOneAndUpdateMock = vi.fn().mockResolvedValue({});

vi.mock('@sallycourse/db', () => ({
  connectDb: vi.fn().mockResolvedValue(undefined),
  Course: {
    findOne: (...args: unknown[]) => courseFindOneMock(...args),
  },
  Deployment: {
    findOneAndUpdate: (...args: unknown[]) => deploymentFindOneAndUpdateMock(...args),
  },
  DEPLOYMENT_MODES: ['auto', 'assisted', 'manual'],
  PlatformCredential: { findOne: vi.fn() },
}));

const queueAddMock = vi.fn().mockResolvedValue({});
const queueRemoveMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/queues', () => ({
  getDeploymentQueue: () => ({ add: queueAddMock, remove: queueRemoveMock }),
}));

// Import APRÈS les mocks (hoisting vi.mock garanti par vitest).
import { POST } from './route';

function mockSessionUser(plan = 'business') {
  requireApiUserMock.mockResolvedValue({ id: 'user-1', plan });
}

function mockCourse(doc: unknown) {
  courseFindOneMock.mockReturnValue({
    select: () => ({ lean: () => Promise.resolve(doc) }),
  });
}

function request(body: unknown): Request {
  return new Request('http://localhost/api/courses/course-1/deploy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: '507f1f77bcf86cd799439011' });

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/courses/[id]/deploy — mention IA générée (P66)', () => {
  it('bloque le déploiement udemy si aiDisclosureAccepted est false', async () => {
    mockSessionUser();
    mockCourse({ _id: 'course-1', status: 'ready', aiDisclosureAccepted: false });

    const res = await POST(request({ platforms: ['udemy'], mode: 'auto' }), { params });

    expect(res.status).toBe(403);
    const data = (await res.json()) as { code?: string };
    expect(data.code).toBe('ai_disclosure_required');
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it('autorise le déploiement udemy si aiDisclosureAccepted est true', async () => {
    mockSessionUser();
    mockCourse({ _id: 'course-1', status: 'ready', aiDisclosureAccepted: true });

    const res = await POST(request({ platforms: ['udemy'], mode: 'auto' }), { params });

    expect(res.status).toBe(202);
    expect(queueAddMock).toHaveBeenCalled();
  });

  it("n'applique pas le gate aux plateformes autres qu'udemy", async () => {
    mockSessionUser();
    mockCourse({ _id: 'course-1', status: 'ready', aiDisclosureAccepted: false });

    const res = await POST(request({ platforms: ['youtube'], mode: 'auto' }), { params });

    expect(res.status).toBe(202);
    expect(queueAddMock).toHaveBeenCalled();
  });

  it('bloque un lot mixte contenant udemy sans mention acceptée', async () => {
    mockSessionUser();
    mockCourse({ _id: 'course-1', status: 'ready', aiDisclosureAccepted: false });

    const res = await POST(
      request({ platforms: ['youtube', 'udemy'], mode: 'auto' }),
      { params },
    );

    expect(res.status).toBe(403);
    expect(queueAddMock).not.toHaveBeenCalled();
  });
});
