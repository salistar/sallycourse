import { afterEach, describe, expect, it, vi } from 'vitest';

// Tests de l'unsubscribe REST Hook Zapier (Prompt 97).

const requireApiKeyUserMock = vi.fn();
vi.mock('@/lib/api-auth', () => ({
  requireApiKeyUser: (...args: unknown[]) => requireApiKeyUserMock(...args),
}));

const webhookDeleteOneMock = vi.fn();
vi.mock('@sallycourse/db', () => ({
  connectDb: vi.fn().mockResolvedValue(undefined),
  Webhook: {
    deleteOne: (...args: unknown[]) => webhookDeleteOneMock(...args),
  },
}));

import { DELETE } from './route';

function mockAuth() {
  requireApiKeyUserMock.mockResolvedValue({ userId: 'user-1', apiKeyId: 'key-1' });
}

const validId = '507f1f77bcf86cd799439011';
const params = (id: string) => Promise.resolve({ id });

afterEach(() => {
  vi.clearAllMocks();
});

describe('DELETE /api/v1/zapier/hooks/[id] (unsubscribe)', () => {
  it('supprime l’abonnement et renvoie ok', async () => {
    mockAuth();
    webhookDeleteOneMock.mockResolvedValue({ deletedCount: 1 });

    const res = await DELETE(new Request('http://localhost'), { params: params(validId) });

    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean };
    expect(data.ok).toBe(true);
    expect(webhookDeleteOneMock).toHaveBeenCalledWith({ _id: validId, userId: 'user-1' });
  });

  it('renvoie 404 si l’abonnement n’existe pas (ou appartient à un autre utilisateur)', async () => {
    mockAuth();
    webhookDeleteOneMock.mockResolvedValue({ deletedCount: 0 });

    const res = await DELETE(new Request('http://localhost'), { params: params(validId) });
    expect(res.status).toBe(404);
  });

  it('renvoie 404 pour un id malformé sans toucher la base', async () => {
    mockAuth();
    const res = await DELETE(new Request('http://localhost'), { params: params('pas-un-id') });
    expect(res.status).toBe(404);
    expect(webhookDeleteOneMock).not.toHaveBeenCalled();
  });

  it('renvoie 401 sans clé API valide', async () => {
    requireApiKeyUserMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
    );
    const res = await DELETE(new Request('http://localhost'), { params: params(validId) });
    expect(res.status).toBe(401);
    expect(webhookDeleteOneMock).not.toHaveBeenCalled();
  });
});
