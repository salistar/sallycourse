import { afterEach, describe, expect, it, vi } from 'vitest';

// Tests du subscribe/list REST Hook Zapier (Prompt 97). Toute la couche infra
// (auth clé API, DB) est mockée — aucune connexion réelle.

const requireApiKeyUserMock = vi.fn();
vi.mock('@/lib/api-auth', () => ({
  requireApiKeyUser: (...args: unknown[]) => requireApiKeyUserMock(...args),
}));

const webhookCreateMock = vi.fn();
const webhookFindMock = vi.fn();
vi.mock('@sallycourse/db', () => ({
  connectDb: vi.fn().mockResolvedValue(undefined),
  Webhook: {
    create: (...args: unknown[]) => webhookCreateMock(...args),
    find: (...args: unknown[]) => webhookFindMock(...args),
  },
  WEBHOOK_EVENTS: ['outline_ready', 'generation_complete', 'deployed', 'review_approved'],
}));

vi.mock('@/lib/webhook-signature', () => ({
  generateWebhookSecret: () => 'secret-de-test',
}));

import { GET, POST } from './route';

function mockAuth() {
  requireApiKeyUserMock.mockResolvedValue({ userId: 'user-1', apiKeyId: 'key-1' });
}

function request(body: unknown): Request {
  return new Request('http://localhost/api/v1/zapier/hooks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sk_test' },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/v1/zapier/hooks (subscribe)', () => {
  it('crée un webhook abonné à un seul événement et renvoie son id', async () => {
    mockAuth();
    webhookCreateMock.mockResolvedValue({
      _id: 'hook-1',
      url: 'https://hooks.zapier.com/abc',
    });

    const res = await POST(
      request({ event: 'generation_complete', targetUrl: 'https://hooks.zapier.com/abc' }),
    );

    expect(res.status).toBe(201);
    const data = (await res.json()) as { id: string; event: string; targetUrl: string };
    expect(data.id).toBe('hook-1');
    expect(data.event).toBe('generation_complete');
    expect(data.targetUrl).toBe('https://hooks.zapier.com/abc');
    expect(webhookCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        url: 'https://hooks.zapier.com/abc',
        events: ['generation_complete'],
        secret: 'secret-de-test',
        active: true,
      }),
    );
  });

  it('rejette un event inconnu', async () => {
    mockAuth();
    const res = await POST(request({ event: 'inconnu', targetUrl: 'https://hooks.zapier.com/abc' }));
    expect(res.status).toBe(400);
    expect(webhookCreateMock).not.toHaveBeenCalled();
  });

  it('rejette une targetUrl invalide', async () => {
    mockAuth();
    const res = await POST(request({ event: 'deployed', targetUrl: 'pas-une-url' }));
    expect(res.status).toBe(400);
    expect(webhookCreateMock).not.toHaveBeenCalled();
  });

  it('renvoie 401 sans clé API valide', async () => {
    requireApiKeyUserMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
    );
    const res = await POST(request({ event: 'deployed', targetUrl: 'https://hooks.zapier.com/x' }));
    expect(res.status).toBe(401);
    expect(webhookCreateMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/zapier/hooks (list)', () => {
  it('liste les abonnements du porteur de la clé', async () => {
    mockAuth();
    webhookFindMock.mockReturnValue({
      select: () => ({
        sort: () => ({
          lean: () =>
            Promise.resolve([
              {
                _id: 'hook-1',
                url: 'https://hooks.zapier.com/abc',
                events: ['deployed'],
                active: true,
                createdAt: new Date('2026-01-01'),
              },
            ]),
        }),
      }),
    });

    const res = await GET(new Request('http://localhost/api/v1/zapier/hooks'));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { hooks: Array<{ id: string; targetUrl: string }> };
    expect(data.hooks).toHaveLength(1);
    expect(data.hooks[0]?.id).toBe('hook-1');
    expect(data.hooks[0]?.targetUrl).toBe('https://hooks.zapier.com/abc');
  });
});
