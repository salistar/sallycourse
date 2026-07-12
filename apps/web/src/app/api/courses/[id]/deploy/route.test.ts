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
const workspaceFindByIdMock = vi.fn();

vi.mock('@sallycourse/db', () => ({
  connectDb: vi.fn().mockResolvedValue(undefined),
  Course: {
    findOne: (...args: unknown[]) => courseFindOneMock(...args),
  },
  Deployment: {
    findOneAndUpdate: (...args: unknown[]) => deploymentFindOneAndUpdateMock(...args),
  },
  Workspace: {
    findById: (...args: unknown[]) => ({ lean: () => workspaceFindByIdMock(...args) }),
  },
  DEPLOYMENT_MODES: ['auto', 'assisted', 'manual'],
  PlatformCredential: { findOne: vi.fn() },
  // P149 : journal d'audit — la route l'appelle (best-effort) à chaque
  // tentative de déploiement ; absente du mock, l'appel réel jetterait.
  recordAudit: vi.fn().mockResolvedValue(undefined),
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

// Test du gate « score de qualité pédagogique » (P94) : bloque sous le seuil
// sans confirmation explicite, mais reste contournable (confirmLowQuality).
describe('POST /api/courses/[id]/deploy — score de qualité (P94)', () => {
  it('bloque le déploiement si le score est sous le seuil sans confirmation', async () => {
    mockSessionUser();
    mockCourse({
      _id: 'course-1',
      status: 'ready',
      aiDisclosureAccepted: true,
      qualityScore: { score: 40, rubric: {}, feedback: [] },
    });

    const res = await POST(request({ platforms: ['youtube'], mode: 'auto' }), { params });

    expect(res.status).toBe(403);
    const data = (await res.json()) as { code?: string; score?: number };
    expect(data.code).toBe('quality_score_below_threshold');
    expect(data.score).toBe(40);
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it('autorise le déploiement sous le seuil avec confirmLowQuality=true', async () => {
    mockSessionUser();
    mockCourse({
      _id: 'course-1',
      status: 'ready',
      aiDisclosureAccepted: true,
      qualityScore: { score: 40, rubric: {}, feedback: [] },
    });

    const res = await POST(
      request({ platforms: ['youtube'], mode: 'auto', confirmLowQuality: true }),
      { params },
    );

    expect(res.status).toBe(202);
    expect(queueAddMock).toHaveBeenCalled();
  });

  it('autorise sans confirmation quand le score atteint le seuil', async () => {
    mockSessionUser();
    mockCourse({
      _id: 'course-1',
      status: 'ready',
      aiDisclosureAccepted: true,
      qualityScore: { score: 75, rubric: {}, feedback: [] },
    });

    const res = await POST(request({ platforms: ['youtube'], mode: 'auto' }), { params });

    expect(res.status).toBe(202);
    expect(queueAddMock).toHaveBeenCalled();
  });

  it('autorise sans confirmation quand aucune évaluation n’a encore tourné', async () => {
    mockSessionUser();
    mockCourse({ _id: 'course-1', status: 'ready', aiDisclosureAccepted: true, qualityScore: null });

    const res = await POST(request({ platforms: ['youtube'], mode: 'auto' }), { params });

    expect(res.status).toBe(202);
    expect(queueAddMock).toHaveBeenCalled();
  });
});

// Test de la gate d'approbation d'équipe (P138) : un cours rattaché à un
// Workspace avec reviewer(s) doit être approuvé (Course.approvedBy) avant
// tout déploiement.
describe('POST /api/courses/[id]/deploy — gate d’approbation d’équipe (P138)', () => {
  it("bloque le déploiement si le workspace a un reviewer et aucune approbation", async () => {
    mockSessionUser();
    mockCourse({
      _id: 'course-1',
      status: 'ready',
      aiDisclosureAccepted: true,
      workspaceId: 'ws-1',
      approvedBy: null,
    });
    workspaceFindByIdMock.mockResolvedValue({
      ownerId: 'owner-1',
      members: [{ userId: 'reviewer-1', role: 'reviewer' }],
    });

    const res = await POST(request({ platforms: ['youtube'], mode: 'auto' }), { params });

    expect(res.status).toBe(403);
    const data = (await res.json()) as { code?: string };
    expect(data.code).toBe('approval_required');
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it('autorise le déploiement une fois approvedBy renseigné', async () => {
    mockSessionUser();
    mockCourse({
      _id: 'course-1',
      status: 'ready',
      aiDisclosureAccepted: true,
      workspaceId: 'ws-1',
      approvedBy: 'reviewer-1',
    });
    workspaceFindByIdMock.mockResolvedValue({
      ownerId: 'owner-1',
      members: [{ userId: 'reviewer-1', role: 'reviewer' }],
    });

    const res = await POST(request({ platforms: ['youtube'], mode: 'auto' }), { params });

    expect(res.status).toBe(202);
    expect(queueAddMock).toHaveBeenCalled();
  });

  it("n'applique aucune gate pour un cours sans workspace (solo)", async () => {
    mockSessionUser();
    mockCourse({ _id: 'course-1', status: 'ready', aiDisclosureAccepted: true });

    const res = await POST(request({ platforms: ['youtube'], mode: 'auto' }), { params });

    expect(res.status).toBe(202);
    expect(workspaceFindByIdMock).not.toHaveBeenCalled();
  });

  it("n'applique aucune gate si le workspace n'a aucun reviewer", async () => {
    mockSessionUser();
    mockCourse({
      _id: 'course-1',
      status: 'ready',
      aiDisclosureAccepted: true,
      workspaceId: 'ws-1',
      approvedBy: null,
    });
    workspaceFindByIdMock.mockResolvedValue({
      ownerId: 'owner-1',
      members: [{ userId: 'editor-1', role: 'editor' }],
    });

    const res = await POST(request({ platforms: ['youtube'], mode: 'auto' }), { params });

    expect(res.status).toBe(202);
    expect(queueAddMock).toHaveBeenCalled();
  });
});
