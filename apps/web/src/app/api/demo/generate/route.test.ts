import { afterEach, describe, expect, it, vi } from 'vitest';

// Tests de la route publique de démo automatique (Prompt 96). Aucune connexion
// Mongo/Redis réelle : rate-limit et @sallycourse/db sont mockés. Vérifie le
// rate limit (3/heure/IP), et surtout l'ISOLATION MOCK FORCÉE : même si
// getConfig() renvoie une clé Anthropic réelle et MOCK_PROVIDERS=false, la
// route ne doit jamais consulter la config ni appeler de provider payant.

const rateLimitMock = vi.fn();
vi.mock('@/lib/rate-limit', () => ({
  extractClientIp: (request: Request) => request.headers.get('x-forwarded-for') ?? 'unknown',
  rateLimit: (...args: unknown[]) => rateLimitMock(...args),
}));

const demoCreateMock = vi.fn();
vi.mock('@sallycourse/db', () => ({
  connectDb: vi.fn().mockResolvedValue(undefined),
  DemoCourse: {
    create: (...args: unknown[]) => demoCreateMock(...args),
  },
  // Consommé par lib/demo-generate.ts (computeDemoExpiresAt) — valeur réelle du modèle.
  DEMO_COURSE_TTL_HOURS: 24,
}));

// getConfig est volontairement fourni avec une clé "réelle" + MOCK_PROVIDERS=false :
// si la route appelait getConfig() ou branchait vers un provider payant, ce test
// le révélerait (aucun mock d'un éventuel appel réseau Anthropic n'est fourni ici,
// il jetterait / ferait un vrai fetch si jamais invoqué).
const getConfigMock = vi.fn().mockReturnValue({
  ANTHROPIC_API_KEY: 'sk-ant-real-key-should-never-be-used',
  MOCK_PROVIDERS: false,
});
vi.mock('@sallycourse/shared', async () => {
  const actual = await vi.importActual<typeof import('@sallycourse/shared')>('@sallycourse/shared');
  return { ...actual, getConfig: () => getConfigMock() };
});

// Import APRÈS les mocks (hoisting vi.mock garanti par vitest).
import { POST } from './route';

function requestWithBody(body: unknown, ip = '198.51.100.7'): Request {
  return new Request('http://localhost/api/demo/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/demo/generate — rate limit', () => {
  it('refuse au-delà de la limite (429 + Retry-After)', async () => {
    rateLimitMock.mockResolvedValue({ allowed: false, remaining: 0, resetAt: new Date(Date.now() + 1800_000) });

    const res = await POST(requestWithBody({ title: 'Photographie culinaire' }));

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect(demoCreateMock).not.toHaveBeenCalled();
  });

  it('applique la clé de rate limit par IP avec la fenêtre 3/heure', async () => {
    rateLimitMock.mockResolvedValue({ allowed: true, remaining: 2, resetAt: new Date() });
    demoCreateMock.mockResolvedValue({
      _id: { toString: () => 'demo-1' },
      title: 'Photographie culinaire',
      expiresAt: new Date('2026-07-12T10:00:00.000Z'),
    });

    await POST(requestWithBody({ title: 'Photographie culinaire' }, '203.0.113.9'));

    expect(rateLimitMock).toHaveBeenCalledWith('demo:ip:203.0.113.9', { limit: 3, windowSec: 3600 });
  });

  it('valide le corps (titre trop court refusé en 400, pas de génération)', async () => {
    rateLimitMock.mockResolvedValue({ allowed: true, remaining: 2, resetAt: new Date() });

    const res = await POST(requestWithBody({ title: 'ab' }));

    expect(res.status).toBe(400);
    expect(demoCreateMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/demo/generate — isolation mock forcée', () => {
  it('ne consulte jamais getConfig() (aucun appel provider payant possible)', async () => {
    rateLimitMock.mockResolvedValue({ allowed: true, remaining: 2, resetAt: new Date() });
    demoCreateMock.mockResolvedValue({
      _id: { toString: () => 'demo-2' },
      title: 'Cuisine végétarienne',
      expiresAt: new Date('2026-07-12T10:00:00.000Z'),
    });

    await POST(requestWithBody({ title: 'Cuisine végétarienne' }));

    expect(getConfigMock).not.toHaveBeenCalled();
  });

  it('persiste toujours mock:true et ne fournit jamais de clé API au générateur', async () => {
    rateLimitMock.mockResolvedValue({ allowed: true, remaining: 2, resetAt: new Date() });
    demoCreateMock.mockResolvedValue({
      _id: { toString: () => 'demo-3' },
      title: 'Cuisine végétarienne',
      expiresAt: new Date('2026-07-12T10:00:00.000Z'),
    });

    await POST(requestWithBody({ title: 'Cuisine végétarienne' }));

    expect(demoCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ mock: true, requesterIp: '198.51.100.7' }),
    );
  });

  it('retourne 201 avec id/title/expiresAt', async () => {
    rateLimitMock.mockResolvedValue({ allowed: true, remaining: 2, resetAt: new Date() });
    demoCreateMock.mockResolvedValue({
      _id: { toString: () => 'demo-4' },
      title: 'Cuisine végétarienne',
      expiresAt: new Date('2026-07-12T10:00:00.000Z'),
    });

    const res = await POST(requestWithBody({ title: 'Cuisine végétarienne' }));
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({
      id: 'demo-4',
      title: 'Cuisine végétarienne',
      expiresAt: '2026-07-12T10:00:00.000Z',
    });
  });
});
