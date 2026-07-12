// Tests comfyui-provider : construction PURE du workflow JSON (aucun I/O),
// verrouillage du style design system dans le prompt, et sélection du repli
// SVG procédural quand ComfyUI est absent/désactivé (MOCK_PROVIDERS). Le seul
// test touchant le réseau (fetch mocké) vérifie le repli sur erreur HTTP.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConfigCache } from '../shared.js';
import {
  COMFYUI_DEFAULT_CHECKPOINT,
  COMFYUI_DEFAULT_HEIGHT,
  COMFYUI_DEFAULT_WIDTH,
  buildComfyUiPrompt,
  buildComfyUiWorkflow,
  comfyUiImageProvider,
  generateSlideIllustration,
  isComfyUiConfigured,
} from './comfyui-provider.js';

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
    MOCK_PROVIDERS: 'false',
    ...overrides,
  });
  for (const key of ['COMFYUI_BASE_URL']) {
    if (!(key in overrides)) delete process.env[key];
  }
  resetConfigCache();
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  setTestEnv({});
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetConfigCache();
});

describe('buildComfyUiPrompt', () => {
  it('référence la palette SALISTAR (violet/or) — style verrouillé au design system', () => {
    const prompt = buildComfyUiPrompt('un graphe de réseaux de neurones');
    expect(prompt).toContain('un graphe de réseaux de neurones');
    expect(prompt).toMatch(/#[0-9A-F]{6}/); // au moins une couleur hex des tokens
    expect(prompt).toContain('flat geometric illustration');
  });

  it('normalise les espaces et tronque un sujet trop long', () => {
    const prompt = buildComfyUiPrompt('  mot1   mot2  ');
    expect(prompt.startsWith('mot1 mot2,')).toBe(true);

    const long = 'x'.repeat(500);
    const truncated = buildComfyUiPrompt(long);
    expect(truncated.startsWith('x'.repeat(300))).toBe(true);
    expect(truncated.length).toBeLessThan(long.length + 200);
  });
});

describe('buildComfyUiWorkflow', () => {
  it('construit un graphe de 7 nœuds avec les dimensions demandées', () => {
    const workflow = buildComfyUiWorkflow({ subject: 'illustration test', width: 800, height: 450 });
    expect(Object.keys(workflow)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    expect((workflow['4'] as { inputs: Record<string, unknown> }).inputs).toMatchObject({ width: 800, height: 450, batch_size: 1 });
  });

  it('applique les dimensions par défaut si absentes', () => {
    const workflow = buildComfyUiWorkflow({ subject: 'x' });
    expect((workflow['4'] as { inputs: Record<string, unknown> }).inputs).toMatchObject({
      width: COMFYUI_DEFAULT_WIDTH,
      height: COMFYUI_DEFAULT_HEIGHT,
    });
  });

  it('utilise le checkpoint par défaut FLUX.1-schnell (4 steps, cfg=1)', () => {
    const workflow = buildComfyUiWorkflow({ subject: 'x' });
    expect((workflow['1'] as { inputs: Record<string, unknown> }).inputs.ckpt_name).toBe(COMFYUI_DEFAULT_CHECKPOINT);
    expect((workflow['5'] as { inputs: Record<string, unknown> }).inputs).toMatchObject({ steps: 4, cfg: 1 });
  });

  it('bascule les paramètres du sampler pour un checkpoint Stable Diffusion (plus de steps)', () => {
    const workflow = buildComfyUiWorkflow({ subject: 'x', checkpoint: 'sd15-pruned-emaonly.safetensors' });
    expect((workflow['5'] as { inputs: Record<string, unknown> }).inputs).toMatchObject({ steps: 20, cfg: 7 });
  });

  it('la seed est déterministe pour un même sujet (reproductibilité)', () => {
    const a = buildComfyUiWorkflow({ subject: 'même sujet' });
    const b = buildComfyUiWorkflow({ subject: 'même sujet' });
    expect((a['5'] as { inputs: Record<string, unknown> }).inputs.seed).toBe((b['5'] as { inputs: Record<string, unknown> }).inputs.seed);
  });

  it('deux sujets différents produisent des seeds différentes', () => {
    const a = buildComfyUiWorkflow({ subject: 'sujet A' });
    const b = buildComfyUiWorkflow({ subject: 'sujet B' });
    expect((a['5'] as { inputs: Record<string, unknown> }).inputs.seed).not.toBe((b['5'] as { inputs: Record<string, unknown> }).inputs.seed);
  });

  it('respecte une seed explicite si fournie', () => {
    const workflow = buildComfyUiWorkflow({ subject: 'x', seed: 42 });
    expect((workflow['5'] as { inputs: Record<string, unknown> }).inputs.seed).toBe(42);
  });

  it('encode le prompt positif verrouillé design system dans le nœud CLIPTextEncode 2', () => {
    const workflow = buildComfyUiWorkflow({ subject: 'un schéma réseau' });
    expect((workflow['2'] as { inputs: Record<string, unknown> }).inputs.text).toContain('un schéma réseau');
    expect((workflow['2'] as { inputs: Record<string, unknown> }).inputs.text).toContain('flat geometric illustration');
  });
});

describe('isComfyUiConfigured', () => {
  it('faux si MOCK_PROVIDERS actif même avec une URL', () => {
    setTestEnv({ COMFYUI_BASE_URL: 'http://localhost:8188', MOCK_PROVIDERS: 'true' });
    expect(isComfyUiConfigured()).toBe(false);
  });

  it('faux si COMFYUI_BASE_URL absente', () => {
    setTestEnv({});
    expect(isComfyUiConfigured()).toBe(false);
  });

  it('vrai si URL configurée et mode mock inactif', () => {
    setTestEnv({ COMFYUI_BASE_URL: 'http://localhost:8188' });
    expect(isComfyUiConfigured()).toBe(true);
  });
});

describe('generateSlideIllustration — repli SVG procédural (comportement PAR DÉFAUT)', () => {
  it('ComfyUI non configuré : retombe directement sur le SVG procédural, aucun appel réseau', async () => {
    setTestEnv({}); // pas de COMFYUI_BASE_URL
    const result = await generateSlideIllustration({
      courseTitle: 'Introduction à Python',
      slideSubject: 'les boucles for',
    });
    expect(result.provider).toBe('procedural-svg');
    expect(result.format).toBe('svg');
    expect(result.buffer.toString('utf-8')).toContain('<svg');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('MOCK_PROVIDERS actif : retombe sur le SVG procédural même avec une URL ComfyUI', async () => {
    setTestEnv({ COMFYUI_BASE_URL: 'http://localhost:8188', MOCK_PROVIDERS: 'true' });
    const result = await generateSlideIllustration({
      courseTitle: 'Cours',
      slideSubject: 'sujet',
    });
    expect(result.provider).toBe('procedural-svg');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ComfyUI configuré mais en échec HTTP : repli silencieux sur le SVG, jamais bloquant', async () => {
    setTestEnv({ COMFYUI_BASE_URL: 'http://localhost:8188' });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'erreur interne' });

    const result = await generateSlideIllustration({
      courseTitle: 'Cours',
      slideSubject: 'sujet en échec',
    });
    expect(result.provider).toBe('procedural-svg');
    expect(result.format).toBe('svg');
  });

  it('ComfyUI configuré et disponible : renvoie le PNG produit', async () => {
    setTestEnv({ COMFYUI_BASE_URL: 'http://localhost:8188' });
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ prompt_id: 'job-1' }) }) // POST /prompt
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'job-1': { outputs: { '7': { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } } },
        }),
      }) // GET /history/job-1
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }); // GET /view

    const result = await generateSlideIllustration({
      courseTitle: 'Cours',
      slideSubject: 'sujet disponible',
    });
    expect(result.provider).toBe('comfyui');
    expect(result.format).toBe('png');
    expect(Array.from(result.buffer)).toEqual([1, 2, 3]);
  });
});

describe('comfyUiImageProvider (contrat ImageProvider)', () => {
  it('expose le nom "comfyui"', () => {
    expect(comfyUiImageProvider.name).toBe('comfyui');
  });

  it('jette si ComfyUI non configuré — laisse l’appelant gérer le repli', async () => {
    setTestEnv({});
    await expect(comfyUiImageProvider.generate('un sujet')).rejects.toThrow(/COMFYUI_BASE_URL/);
  });
});
