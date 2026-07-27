// Tests des liens TP interactifs (Prompt 84) : détection de langage (pure),
// construction des payloads StackBlitz/CodeSandbox (pure), et création des
// liens avec fetch mocké (mode réel) + mode MOCK_PROVIDERS (zéro réseau).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConfigCache } from '../shared.js';
import {
  buildCodesandboxPayload,
  buildStackblitzPayload,
  buildTpProjectFiles,
  createSandboxLinks,
  detectTpLanguage,
} from './sandbox-links.js';
import { mockTpContent } from '../generators/tp.js';

/** Environnement complet et valide pour getConfig (aucun accès réseau). */
function setTestEnv(overrides: Record<string, string> = {}): void {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    APP_URL: 'http://localhost:3000',
    MONGO_URI: 'mongodb://localhost:27017/test',
    REDIS_URL: 'redis://localhost:6379',
    S3_ENDPOINT: 'http://localhost:9000',
    S3_ACCESS_KEY: 'test',
    S3_SECRET_KEY: 'test',
    S3_BUCKET: 'test',
    S3_REGION: 'us-east-1',
    AUTH_SECRET: 'secret-de-test-suffisamment-long',
    CREDENTIALS_MASTER_KEY: 'a'.repeat(64),
    ANTHROPIC_API_KEY: 'sk-ant-test',
    MOCK_PROVIDERS: 'false',
    ...overrides,
  });
  resetConfigCache();
}

beforeEach(() => {
  setTestEnv();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('detectTpLanguage', () => {
  it('détecte javascript via npm/node', () => {
    const lang = detectTpLanguage({
      environment: ['Node.js 20+ installé'],
      steps: [{ command: 'npm run dev' }],
    });
    expect(lang).toBe('javascript');
  });

  it('détecte typescript via extension .ts', () => {
    const lang = detectTpLanguage({
      environment: ['Un projet TypeScript'],
      steps: [{ command: 'npx tsc index.ts' }],
    });
    expect(lang).toBe('typescript');
  });

  it('détecte python via pip/python', () => {
    const lang = detectTpLanguage({
      environment: ['Python 3.11'],
      steps: [{ command: 'python3 app.py' }],
    });
    expect(lang).toBe('python');
  });

  it("retourne undefined quand aucun langage n'est reconnaissable", () => {
    const lang = detectTpLanguage({
      environment: ['Un compte sur la plateforme cloud'],
      steps: [{ instruction: 'Cliquez sur le bouton bleu' } as { command?: string }],
    });
    expect(lang).toBeUndefined();
  });
});

describe('buildStackblitzPayload (pur)', () => {
  it('encode titre + template + fichiers en form-urlencoded', () => {
    const body = buildStackblitzPayload('Mon TP', 'javascript', { 'index.js': 'console.log(1)' });
    expect(body.get('project[title]')).toBe('Mon TP');
    expect(body.get('project[template]')).toBe('javascript');
    expect(body.get('project[files][index.js]')).toBe('console.log(1)');
  });
});

describe('buildCodesandboxPayload (pur)', () => {
  it('encode le template et les fichiers au format { content }', () => {
    const payload = buildCodesandboxPayload('typescript', { 'index.ts': 'const x = 1;' });
    expect(payload.template).toBe('node');
    expect(payload.files['index.ts']).toEqual({ content: 'const x = 1;' });
  });
});

describe('buildTpProjectFiles (pur)', () => {
  it('produit un README identique et un main.<ext> starter/solution différents', () => {
    const tp = mockTpContent('Boucles for');
    const { starterFiles, solutionFiles } = buildTpProjectFiles(tp, 'javascript');
    expect(starterFiles['README.md']).toBe(solutionFiles['README.md']);
    expect(starterFiles['main.js']).not.toBe(solutionFiles['main.js']);
    // La solution contient la vraie commande, le starter un TODO.
    expect(solutionFiles['main.js']).toContain('npm run dev');
    expect(starterFiles['main.js']).toContain('TODO');
  });
});

describe('createSandboxLinks — mode MOCK_PROVIDERS', () => {
  it('renvoie des URLs déterministes sans appel réseau', async () => {
    setTestEnv({ MOCK_PROVIDERS: 'true' });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const files = { 'main.js': 'console.log(1)' };
    const result = await createSandboxLinks({
      title: 'Mon TP',
      language: 'javascript',
      starterFiles: files,
      solutionFiles: files,
    });
    if (!result) throw new Error('createSandboxLinks a renvoyé null en mode mock');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.starter.stackblitzUrl).toMatch(/^https:\/\/stackblitz\.com\/edit\/mock-/);
    expect(result.starter.codesandboxUrl).toMatch(/^https:\/\/codesandbox\.io\/s\/mock-/);
    expect(result.solution.stackblitzUrl).toMatch(/^https:\/\/stackblitz\.com\/edit\/mock-/);

    // Déterminisme : mêmes fichiers + même titre → même URL.
    const again = await createSandboxLinks({
      title: 'Mon TP',
      language: 'javascript',
      starterFiles: files,
      solutionFiles: files,
    });
    if (!again) throw new Error('createSandboxLinks a renvoyé null en mode mock');
    expect(again.starter.stackblitzUrl).toBe(result.starter.stackblitzUrl);
  });

  it('les projets starter et solution diffèrent (fichiers de contenu différents)', async () => {
    setTestEnv({ MOCK_PROVIDERS: 'true' });
    const result = await createSandboxLinks({
      title: 'Mon TP',
      language: 'javascript',
      starterFiles: { 'main.js': '// TODO' },
      solutionFiles: { 'main.js': 'console.log("done")' },
    });
    if (!result) throw new Error('createSandboxLinks a renvoyé null en mode mock');
    expect(result.starter.stackblitzUrl).not.toBe(result.solution.stackblitzUrl);
  });
});

describe('createSandboxLinks — mode réel (fetch mocké)', () => {
  it('appelle StackBlitz et CodeSandbox et assemble les URLs retournées', async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes('stackblitz.com')) {
        return {
          ok: true,
          status: 200,
          headers: { get: (h: string) => (h === 'location' ? 'https://stackblitz.com/edit/abc123' : null) },
          text: async () => '',
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ sandbox_id: 'xyz789' }),
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await createSandboxLinks({
      title: 'Mon TP',
      language: 'javascript',
      starterFiles: { 'main.js': '// TODO' },
      solutionFiles: { 'main.js': 'console.log(1)' },
    });
    if (!result) throw new Error('createSandboxLinks a renvoyé null en mode mock');

    expect(fetchSpy).toHaveBeenCalledTimes(4); // 2 IDE × (starter + solution)
    expect(result.starter.stackblitzUrl).toBe('https://stackblitz.com/edit/abc123');
    expect(result.starter.codesandboxUrl).toBe('https://codesandbox.io/s/xyz789');
  });

  it('renvoie null si le réseau échoue hors mode mock (jamais d’URL fictive persistable)', async () => {
    // Intégrité (audit 2026-07-17) : hors MOCK_PROVIDERS, un échec de création
    // ne fabrique PLUS d'URL mock — des liens morts finiraient dans le cours
    // livré. null → l'appelant (attachSandboxLinksBestEffort) saute la
    // persistance, la leçon reste simplement sans sandbox. Ne jette jamais.
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));

    const result = await createSandboxLinks({
      title: 'Mon TP',
      language: 'python',
      starterFiles: { 'main.py': 'pass' },
      solutionFiles: { 'main.py': 'print(1)' },
    });

    expect(result).toBeNull();
  });
});
