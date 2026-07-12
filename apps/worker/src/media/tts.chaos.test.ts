// Tests de chaos (Prompt 128) : ElevenLabs qui échoue en boucle doit ouvrir le
// circuit breaker (Prompt 77) et basculer vers le repli OpenAI SANS attendre
// inutilement — dès que le circuit est ouvert, les appels suivants court-
// circuitent ElevenLabs immédiatement (CircuitOpenError catché en interne)
// plutôt que de retenter un service manifestement down à chaque slide.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// execa mocké : aucun ffmpeg réel invoqué. La normalisation loudness (ffmpeg)
// doit tout de même écrire un fichier de sortie factice (dernier argument),
// sinon la lecture ultérieure (readFile avant upload) échouerait en ENOENT.
vi.mock('execa', async () => {
  const { writeFile } = await import('node:fs/promises');
  return {
    execa: vi.fn(async (_cmd: string, args: string[] = []) => {
      const last = args[args.length - 1];
      if (typeof last === 'string' && last.endsWith('.mp3')) {
        await writeFile(last, Buffer.from('fake-normalized-mp3'));
      }
      return { stdout: '3.5' }; // ffprobe : durée factice en secondes
    }),
  };
});

// Storage/S3 mocké : jamais de cache présent (force le chemin réseau), upload
// et lecture no-op (le test ne vérifie pas le contenu binaire final).
const mockObjectExists = vi.hoisted(() => vi.fn(async () => false));
const mockUploadObject = vi.hoisted(() => vi.fn(async () => undefined));
const mockGetConfig = vi.hoisted(() => vi.fn());
vi.mock('../shared.js', async () => {
  const actual = await vi.importActual<typeof import('../shared.js')>('../shared.js');
  return {
    ...actual,
    getConfig: mockGetConfig,
    objectExists: mockObjectExists,
    uploadObject: mockUploadObject,
  };
});

vi.mock('../queues/index.js', () => ({
  logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
}));

// Redis mocké (persistSnapshot du circuit breaker) : best-effort, jamais de
// vraie connexion pendant les tests.
vi.mock('../queues/connection.js', () => ({
  getRedisConnection: () => ({ set: async () => 'OK' }),
}));

import { synthesizeSlide, elevenLabsBreaker } from './tts.js';
import { resetCircuitBreakerRegistryForTests } from '../lib/circuit-breaker.js';

/** Réponse fetch 429 (quota dépassé) — bascule éligible vers le repli. */
function quotaExceededResponse(): Response {
  return new Response('quota dépassé', { status: 429 });
}

/** Réponse fetch 200 avec un petit buffer mp3 factice. */
function okAudioResponse(): Response {
  return new Response(Buffer.from('fake-mp3-bytes'), {
    status: 200,
    headers: { 'content-type': 'audio/mpeg' },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  resetCircuitBreakerRegistryForTests();
  // elevenLabsBreaker est un singleton importé une seule fois par le module
  // tts.ts : resetCircuitBreakerRegistryForTests() ne vide que le registre
  // d'exposition (Map), pas l'état interne de CETTE instance déjà créée. Sans
  // ce reset explicite, un test qui ouvre le circuit (5 échecs) laisse le
  // breaker 'open' pour tous les tests suivants du même fichier.
  elevenLabsBreaker.resetForTests();
  mockObjectExists.mockClear();
  mockUploadObject.mockClear();
  mockGetConfig.mockReturnValue({
    MOCK_PROVIDERS: false,
    ELEVENLABS_API_KEY: 'sk-el-test',
    OPENAI_API_KEY: 'sk-oa-test',
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('synthesizeSlide — ElevenLabs down en boucle : circuit breaker + fallback OpenAI (Prompt 128)', () => {
  it('après 5 échecs ElevenLabs consécutifs, le circuit breaker "elevenlabs-tts" s\'ouvre', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('elevenlabs')) return quotaExceededResponse();
      return okAudioResponse();
    });
    vi.stubGlobal('fetch', fetchMock);

    // 5 slides consécutives : chacune tente ElevenLabs (429) puis bascule OpenAI.
    for (let i = 0; i < 5; i += 1) {
      const result = await synthesizeSlide({ text: `Slide numéro ${i} avec assez de mots`, locale: 'fr' });
      expect(result.provider).toBe('openai');
    }

    expect(elevenLabsBreaker.snapshot().state).toBe('open');
    expect(elevenLabsBreaker.snapshot().failureCount).toBe(5);
  });

  it('une fois le circuit ouvert, les appels suivants court-circuitent ElevenLabs SANS latence réseau (pas de nouvel appel fetch ElevenLabs)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('elevenlabs')) return quotaExceededResponse();
      return okAudioResponse();
    });
    vi.stubGlobal('fetch', fetchMock);

    // Ouvre le circuit (5 échecs).
    for (let i = 0; i < 5; i += 1) {
      await synthesizeSlide({ text: `Ouverture du circuit slide ${i} texte suffisant`, locale: 'fr' });
    }
    expect(elevenLabsBreaker.snapshot().state).toBe('open');
    const callsAfterOpening = fetchMock.mock.calls.length;

    // Slide suivante, PENDANT la fenêtre resetTimeoutMs (60s) : le breaker doit
    // rejeter IMMÉDIATEMENT (CircuitOpenError) sans exécuter le fetch ElevenLabs
    // — seul l'appel OpenAI (repli) doit apparaître dans les nouveaux appels.
    const result = await synthesizeSlide({ text: 'Slide juste après ouverture, texte suffisant ici', locale: 'fr' });
    expect(result.provider).toBe('openai');

    const newCalls = fetchMock.mock.calls.slice(callsAfterOpening);
    const newElevenLabsCalls = newCalls.filter(([url]) => String(url).includes('elevenlabs'));
    const newOpenAiCalls = newCalls.filter(([url]) => String(url).includes('openai'));
    expect(newElevenLabsCalls).toHaveLength(0); // court-circuité par le breaker, pas de nouvel appel réseau
    expect(newOpenAiCalls).toHaveLength(1); // le repli OpenAI, lui, s'exécute normalement
  });

  it('le fallback OpenAI produit un résultat exploitable (provider, durée mesurée) même circuit ouvert', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('elevenlabs')) return quotaExceededResponse();
      return okAudioResponse();
    });
    vi.stubGlobal('fetch', fetchMock);

    for (let i = 0; i < 5; i += 1) {
      await synthesizeSlide({ text: `Chauffe circuit slide ${i} texte suffisant pour le test`, locale: 'fr' });
    }

    const result = await synthesizeSlide({ text: 'Dernière slide après ouverture du circuit', locale: 'fr' });
    expect(result.provider).toBe('openai');
    expect(result.seconds).toBeGreaterThan(0);
    expect(mockUploadObject).toHaveBeenCalled();
  });
});

describe('synthesizeSlide — ElevenLabs devient PREMIUM (Prompt 153)', () => {
  it('plan free : ElevenLabs jamais tenté, bascule directe vers OpenAI (repli universel)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('elevenlabs')) throw new Error('ElevenLabs ne doit jamais être appelé pour le plan free');
      return okAudioResponse();
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await synthesizeSlide({
      text: 'Slide de test plan free, texte suffisamment long',
      locale: 'fr',
      plan: 'free',
    });

    expect(result.provider).toBe('openai');
    const elevenLabsCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('elevenlabs'));
    expect(elevenLabsCalls).toHaveLength(0);
  });

  it('plan pro : ElevenLabs autorisé et tenté normalement', async () => {
    const fetchMock = vi.fn(async () => okAudioResponse());
    vi.stubGlobal('fetch', fetchMock);

    const result = await synthesizeSlide({
      text: 'Slide de test plan pro, texte suffisamment long',
      locale: 'fr',
      plan: 'pro',
    });

    expect(result.provider).toBe('elevenlabs');
  });

  it('plan absent (rétrocompatibilité) : ElevenLabs reste tenté comme avant P153', async () => {
    const fetchMock = vi.fn(async () => okAudioResponse());
    vi.stubGlobal('fetch', fetchMock);

    const result = await synthesizeSlide({ text: 'Slide sans plan explicite, texte suffisant', locale: 'fr' });

    expect(result.provider).toBe('elevenlabs');
  });
});
