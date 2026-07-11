import { afterEach, describe, expect, it, vi } from 'vitest';

// Visibilité publique/privée des presets de déploiement (P109) : GET doit
// renvoyer séparément « mes presets » (tous, quel que soit isPublic) et les
// « presets publics » d'AUTRES utilisateurs (jamais les presets privés d'autrui).

const requireApiUserMock = vi.fn();
vi.mock('@/lib/session', () => ({
  requireApiUser: () => requireApiUserMock(),
}));

const findMock = vi.fn();
const createMock = vi.fn();
vi.mock('@sallycourse/db', () => ({
  connectDb: vi.fn().mockResolvedValue(undefined),
  DeployPreset: {
    find: (...args: unknown[]) => findMock(...args),
    create: (...args: unknown[]) => createMock(...args),
  },
  DEPLOYMENT_MODES: ['auto', 'assisted', 'manual'],
}));

vi.mock('@/lib/deploy-catalog', () => ({
  isKnownPlatform: (id: string) => ['udemy', 'youtube', 'gumroad'].includes(id),
}));

import { GET, POST } from './route';

function mockSessionUser(id = 'user-1') {
  requireApiUserMock.mockResolvedValue({ id, plan: 'business' });
}

function chainable(result: unknown[]) {
  const chain = {
    sort: () => chain,
    limit: () => chain,
    lean: () => Promise.resolve(result),
  };
  return chain;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/deploy-presets — visibilité publique/privée', () => {
  it("retourne mes presets (y compris privés) séparément des presets publics d'autrui", async () => {
    mockSessionUser('user-1');

    const minePrivate = { _id: 'p1', userId: 'user-1', name: 'Mon preset privé', platforms: [], isPublic: false, createdAt: new Date(), updatedAt: new Date() };
    const minePublic = { _id: 'p2', userId: 'user-1', name: 'Mon preset public', platforms: [], isPublic: true, createdAt: new Date(), updatedAt: new Date() };
    const othersPublic = { _id: 'p3', userId: 'user-2', name: 'Preset partagé', platforms: [], isPublic: true, createdAt: new Date(), updatedAt: new Date() };

    findMock
      .mockReturnValueOnce(chainable([minePrivate, minePublic]))
      .mockReturnValueOnce(chainable([othersPublic]));

    const res = await GET();
    expect(res.status).toBe(200);
    const data = (await res.json()) as { presets: { id: string }[]; publicPresets: { id: string }[] };

    expect(data.presets.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(data.publicPresets.map((p) => p.id)).toEqual(['p3']);

    // La requête des presets publics exclut bien l'utilisateur courant.
    expect(findMock).toHaveBeenNthCalledWith(2, {
      isPublic: true,
      userId: { $ne: 'user-1' },
    });
  });

  it("ne renvoie aucun preset privé d'autrui même si publicPresets est vide", async () => {
    mockSessionUser('user-1');
    findMock.mockReturnValueOnce(chainable([])).mockReturnValueOnce(chainable([]));

    const res = await GET();
    const data = (await res.json()) as { presets: unknown[]; publicPresets: unknown[] };
    expect(data.presets).toEqual([]);
    expect(data.publicPresets).toEqual([]);
  });
});

describe('POST /api/deploy-presets — création', () => {
  it('crée un preset avec isPublic par défaut à false', async () => {
    mockSessionUser('user-1');
    createMock.mockResolvedValue({
      _id: 'p1',
      name: 'Mon combo',
      platforms: [{ platform: 'youtube', mode: 'auto' }],
      isPublic: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await POST(
      new Request('http://localhost/api/deploy-presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Mon combo',
          platforms: [{ platform: 'youtube', mode: 'auto' }],
        }),
      }),
    );

    expect(res.status).toBe(201);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', isPublic: false }),
    );
  });

  it('rejette une plateforme inconnue', async () => {
    mockSessionUser('user-1');

    const res = await POST(
      new Request('http://localhost/api/deploy-presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Combo invalide',
          platforms: [{ platform: 'plateforme-inconnue', mode: 'auto' }],
        }),
      }),
    );

    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });
});
