import { describe, expect, it, vi } from 'vitest';
import { run, type Io } from './index.js';

// Tests d'intégration du dispatch avec fetch injecté (aucun réseau réel).

function makeIo(overrides: Partial<Io> = {}): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    env: {
      SALLYCOURSE_API_URL: 'https://app.tld',
      SALLYCOURSE_API_KEY: 'sk_live_test',
    } as NodeJS.ProcessEnv,
    log: (m) => out.push(m),
    error: (m) => err.push(m),
    ...overrides,
  };
  return { io, out, err };
}

/** Fabrique une Response JSON minimale. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('run — aide et erreurs', () => {
  it('affiche l\'aide sans commande (code 0)', async () => {
    const { io, out } = makeIo();
    const code = await run([], io);
    expect(code).toBe(0);
    expect(out.join('\n')).toMatch(/Usage/);
  });

  it('commande inconnue → code 1', async () => {
    const { io, err } = makeIo();
    const code = await run(['frobnicate'], io);
    expect(code).toBe(1);
    expect(err.join('\n')).toMatch(/inconnue/);
  });
});

describe('run create', () => {
  it('POST /api/v1/courses avec Bearer et corps normalisé', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.title).toBe('Docker pour DevOps');
      expect(body.difficulty).toBe('intermediate');
      expect(body.targetPlatforms).toEqual(['udemy', 'youtube']);
      return jsonResponse({ id: 'c1', title: body.title, status: 'generating' }, 201);
    }) as unknown as typeof fetch;

    const { io, out } = makeIo({ fetchImpl });
    const code = await run(
      ['create', 'Docker pour DevOps', '--level', 'intermediate', '--deploy', 'udemy,youtube', '--lang', 'fr'],
      io,
    );
    expect(code).toBe(0);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]!;
    expect(url).toBe('https://app.tld/api/v1/courses');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk_live_test');
    expect(out.join('\n')).toMatch(/c1/);
  });

  it('batch depuis --file : un POST par titre', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return jsonResponse({ id: `id-${body.title}`, title: body.title, status: 'generating' }, 201);
    }) as unknown as typeof fetch;

    const readFileImpl = async () => 'Cours A\nCours B | level=advanced';
    const { io } = makeIo({ fetchImpl, readFileImpl });
    const code = await run(['create', '--file', 'titres.txt'], io);
    expect(code).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('titre manquant → code 1', async () => {
    const { io, err } = makeIo();
    const code = await run(['create'], io);
    expect(code).toBe(1);
    expect(err.join('\n')).toMatch(/Titre manquant/);
  });
});

describe('run status', () => {
  it('GET /api/v1/courses/:id et affiche les déploiements', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        id: 'c1',
        title: 'Docker',
        status: 'ready',
        deployments: [{ platform: 'udemy', status: 'published', externalUrl: 'https://u/1' }],
      }),
    ) as unknown as typeof fetch;

    const { io, out } = makeIo({ fetchImpl });
    const code = await run(['status', 'c1'], io);
    expect(code).toBe(0);
    const [url] = (fetchImpl as unknown as { mock: { calls: [string][] } }).mock.calls[0]!;
    expect(url).toBe('https://app.tld/api/v1/courses/c1');
    expect(out.join('\n')).toMatch(/udemy/);
  });

  it('erreur serveur 404 → code 1 avec message', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'Cours introuvable.' }, 404),
    ) as unknown as typeof fetch;
    const { io, err } = makeIo({ fetchImpl });
    const code = await run(['status', 'nope', '--api-url', 'https://app.tld', '--api-key', 'sk_live_x'], io);
    expect(code).toBe(1);
    expect(err.join('\n')).toMatch(/introuvable/);
  });
});

describe('run deploy', () => {
  it('POST deploy avec plateformes et mode', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.platforms).toEqual(['udemy', 'youtube']);
      expect(body.mode).toBe('auto');
      return jsonResponse({ courseId: 'c1', deployments: [{ platform: 'udemy', mode: 'auto' }] }, 202);
    }) as unknown as typeof fetch;

    const { io } = makeIo({ fetchImpl });
    const code = await run(['deploy', 'c1', '--platforms', 'udemy,youtube'], io);
    expect(code).toBe(0);
    const [url] = (fetchImpl as unknown as { mock: { calls: [string][] } }).mock.calls[0]!;
    expect(url).toBe('https://app.tld/api/v1/courses/c1/deploy');
  });

  it('sans --platforms → code 1', async () => {
    const { io, err } = makeIo();
    const code = await run(['deploy', 'c1'], io);
    expect(code).toBe(1);
    expect(err.join('\n')).toMatch(/plateforme/i);
  });
});
