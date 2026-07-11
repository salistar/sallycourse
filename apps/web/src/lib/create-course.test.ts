import { afterEach, describe, expect, it, vi } from 'vitest';

// Tests de createCourseForUser — logique métier partagée de création de cours
// (P51/P53), en particulier la protection anti-double-clic (P120) : un second
// POST avec le même titre pour le même utilisateur dans la fenêtre de
// déduplication doit renvoyer le cours déjà créé, SANS consommer de quota ni
// enfiler un second job. @sallycourse/db, quota.ts, queues.ts et
// title-similarity.ts sont mockés (aucune connexion Mongo/Redis réelle).

const findMock = vi.fn();
const createMock = vi.fn();
const updateOneMock = vi.fn();
const generationJobCreateMock = vi.fn();
const notifyMock = vi.fn();

vi.mock('@sallycourse/db', () => ({
  connectDb: vi.fn().mockResolvedValue(undefined),
  Course: {
    find: (...args: unknown[]) => findMock(...args),
    create: (...args: unknown[]) => createMock(...args),
    updateOne: (...args: unknown[]) => updateOneMock(...args),
  },
  GenerationJob: {
    create: (...args: unknown[]) => generationJobCreateMock(...args),
  },
  notify: (...args: unknown[]) => notifyMock(...args),
}));

const reserveQuotaMock = vi.fn();
const releaseQuotaMock = vi.fn();

vi.mock('./quota', () => ({
  checkAndReserveCourseQuota: (...args: unknown[]) => reserveQuotaMock(...args),
  releaseQuota: (...args: unknown[]) => releaseQuotaMock(...args),
}));

const queueAddMock = vi.fn();

vi.mock('./queues', () => ({
  getOutlineQueue: () => ({ add: queueAddMock }),
}));

vi.mock('./title-similarity', () => ({
  findMostSimilarTitle: vi.fn(() => undefined),
}));

// Import APRÈS les mocks (hoisting vi.mock garanti par vitest).
import { createCourseForUser } from './create-course';

/** Fabrique un chaînage find().select().sort().lean() résolvant `docs` (dédup). */
function mockRecentCandidates(docs: unknown[]) {
  findMock.mockReturnValueOnce({
    select: () => ({ sort: () => ({ lean: () => Promise.resolve(docs) }) }),
  });
}

/** Fabrique le chaînage find().select().lean() résolvant `docs` (similarité). */
function mockSimilarityCandidates(docs: unknown[] = []) {
  findMock.mockReturnValueOnce({ select: () => ({ lean: () => Promise.resolve(docs) }) });
}

const baseInput = {
  title: 'Maîtriser React',
  difficulty: 'beginner' as const,
  locale: 'fr' as const,
  targetPlatforms: [] as string[],
};

afterEach(() => {
  findMock.mockReset();
  createMock.mockReset();
  updateOneMock.mockReset();
  generationJobCreateMock.mockReset();
  notifyMock.mockReset();
  reserveQuotaMock.mockReset();
  releaseQuotaMock.mockReset();
  queueAddMock.mockReset();
});

describe('createCourseForUser — anti-double-clic (P120)', () => {
  it('renvoie le cours existant sans consommer de quota si le même titre a été soumis dans la fenêtre', async () => {
    mockRecentCandidates([
      { _id: 'course-existant', title: 'Maîtriser React', status: 'generating', createdAt: new Date() },
    ]);

    const result = await createCourseForUser('user-1', 'free', baseInput);

    expect(result).toEqual({
      ok: true,
      id: 'course-existant',
      title: 'Maîtriser React',
      status: 'generating',
      deduped: true,
    });
    // Aucun crédit consommé, aucune création, aucun job enfilé.
    expect(reserveQuotaMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it('compare le titre normalisé (trim + casse insensible)', async () => {
    mockRecentCandidates([
      { _id: 'course-existant', title: '  MAÎTRISER react  ', status: 'draft', createdAt: new Date() },
    ]);

    const result = await createCourseForUser('user-1', 'free', baseInput);

    expect(result.ok).toBe(true);
    expect(result.ok && result.deduped).toBe(true);
  });

  it('ignore un titre récent DIFFÉRENT — crée normalement un nouveau cours', async () => {
    mockRecentCandidates([
      { _id: 'course-autre', title: 'Cours totalement différent', status: 'ready', createdAt: new Date() },
    ]);
    mockSimilarityCandidates([]);
    reserveQuotaMock.mockResolvedValue({ ok: true });
    createMock.mockResolvedValue({
      _id: { toString: () => 'course-nouveau' },
      title: 'Maîtriser React',
      status: 'generating',
    });
    generationJobCreateMock.mockResolvedValue(undefined);
    queueAddMock.mockResolvedValue(undefined);

    const result = await createCourseForUser('user-1', 'free', baseInput);

    expect(result.ok).toBe(true);
    expect(result.ok && result.id).toBe('course-nouveau');
    expect(result.ok && result.deduped).toBeUndefined();
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(queueAddMock).toHaveBeenCalledTimes(1);
  });

  it('n’applique la déduplication qu’au même utilisateur (le mock filtre déjà par userId — vérifie juste l’absence de faux positif au titre)', async () => {
    // Aucun candidat récent pour CET utilisateur (le filtre {userId} est passé
    // à Course.find par l'appelant — ici on simule juste une liste vide).
    mockRecentCandidates([]);
    mockSimilarityCandidates([]);
    reserveQuotaMock.mockResolvedValue({ ok: true });
    createMock.mockResolvedValue({
      _id: { toString: () => 'course-x' },
      title: 'Maîtriser React',
      status: 'generating',
    });
    generationJobCreateMock.mockResolvedValue(undefined);
    queueAddMock.mockResolvedValue(undefined);

    const result = await createCourseForUser('user-2', 'free', baseInput);

    expect(result.ok).toBe(true);
    expect(result.ok && result.deduped).toBeUndefined();
  });

  it('propage l’erreur quota normalement quand il n’y a pas de doublon récent', async () => {
    mockRecentCandidates([]);
    reserveQuotaMock.mockResolvedValue({ ok: false, reason: 'quota_exceeded', plan: 'free', limit: 3 });
    notifyMock.mockResolvedValue(undefined);

    const result = await createCourseForUser('user-1', 'free', baseInput);

    expect(result).toEqual({ ok: false, error: { kind: 'quota', limit: 3, plan: 'free' } });
    expect(createMock).not.toHaveBeenCalled();
  });
});
