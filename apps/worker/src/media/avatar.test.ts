// Tests des helpers PURS de l'avatar vidéo (P82) : construction de la requête
// HeyGen (forme du corps), boucle de polling (dépendances injectées, sans
// réseau ni vrai délai), et repli mock (déterministe, sans clé HeyGen).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// execa mocké : aucun ffmpeg réel invoqué pendant les tests.
vi.mock('execa', () => ({ execa: vi.fn(async () => ({ stdout: '' })) }));

// renderIntroCard mocké (dépend de Playwright + Mongo) : retourne un buffer
// PNG factice, suffisant pour vérifier le CHEMIN emprunté par le repli mock.
const mockRenderIntroCard = vi.hoisted(() => vi.fn(async () => Buffer.from('fake-png')));
vi.mock('./slide-renderer.js', () => ({ renderIntroCard: mockRenderIntroCard }));

// getConfig mocké : contrôle direct de MOCK_PROVIDERS / HEYGEN_API_KEY sans
// dépendre des variables d'environnement réelles du process de test.
const mockGetConfig = vi.hoisted(() => vi.fn());
vi.mock('../shared.js', async () => {
  const actual = await vi.importActual<typeof import('../shared.js')>('../shared.js');
  return { ...actual, getConfig: mockGetConfig };
});

import {
  AvatarGenerationError,
  buildHeyGenGenerateRequest,
  generateAvatarSegment,
  pollHeyGenUntilDone,
  type HeyGenStatusResponse,
} from './avatar.js';

beforeEach(() => {
  mockRenderIntroCard.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('buildHeyGenGenerateRequest', () => {
  it('construit un corps landscape 1920x1080 par défaut', () => {
    const body = buildHeyGenGenerateRequest('Bonjour', 'avatar-1') as {
      video_inputs: Array<{
        character: { type: string; avatar_id: string };
        voice: { type: string; input_text: string; voice_id: string };
      }>;
      dimension: { width: number; height: number };
    };
    expect(body.video_inputs).toHaveLength(1);
    expect(body.video_inputs[0]!.character.avatar_id).toBe('avatar-1');
    expect(body.video_inputs[0]!.voice.input_text).toBe('Bonjour');
    expect(body.dimension).toEqual({ width: 1920, height: 1080 });
  });

  it('bascule en portrait (dimensions inversées) sur demande', () => {
    const body = buildHeyGenGenerateRequest('Texte', 'avatar-2', { aspectRatio: 'portrait' }) as {
      dimension: { width: number; height: number };
    };
    expect(body.dimension).toEqual({ width: 1080, height: 1920 });
  });

  it('utilise la voix fournie plutôt que la voix par défaut', () => {
    const body = buildHeyGenGenerateRequest('Texte', 'avatar-3', { voiceId: 'ma-voix' }) as {
      video_inputs: Array<{ voice: { voice_id: string } }>;
    };
    expect(body.video_inputs[0]!.voice.voice_id).toBe('ma-voix');
  });
});

describe('pollHeyGenUntilDone', () => {
  it('retourne la video_url dès que le statut passe à completed', async () => {
    const responses: HeyGenStatusResponse[] = [
      { status: 'processing' },
      { status: 'processing' },
      { status: 'completed', videoUrl: 'https://cdn.example/video.mp4' },
    ];
    let call = 0;
    const fetchStatus = vi.fn(async () => responses[call++]!);
    const wait = vi.fn(async () => undefined);

    const url = await pollHeyGenUntilDone('vid-1', 'key', {
      pollIntervalMs: 1000,
      pollTimeoutMs: 60_000,
      fetchStatus,
      wait,
    });

    expect(url).toBe('https://cdn.example/video.mp4');
    expect(fetchStatus).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it('jette une AvatarGenerationError si le statut passe à failed', async () => {
    const fetchStatus = vi.fn(async () => ({ status: 'failed', error: 'GPU indisponible' }) as HeyGenStatusResponse);
    const wait = vi.fn(async () => undefined);

    await expect(
      pollHeyGenUntilDone('vid-2', 'key', { pollIntervalMs: 1000, pollTimeoutMs: 60_000, fetchStatus, wait }),
    ).rejects.toThrow(/GPU indisponible/);
  });

  it('jette une AvatarGenerationError après timeout (deadline dépassée)', async () => {
    // now() avance de 10s à chaque appel simulé -> dépasse vite le timeout de 20s.
    let elapsed = 0;
    const now = () => {
      elapsed += 10_000;
      return elapsed;
    };
    const fetchStatus = vi.fn(async () => ({ status: 'processing' }) as HeyGenStatusResponse);
    const wait = vi.fn(async () => undefined);

    await expect(
      pollHeyGenUntilDone('vid-3', 'key', {
        pollIntervalMs: 1000,
        pollTimeoutMs: 20_000,
        fetchStatus,
        wait,
        now,
      }),
    ).rejects.toThrow(AvatarGenerationError);
  });

  it('jette une erreur explicite si completed sans video_url', async () => {
    const fetchStatus = vi.fn(async () => ({ status: 'completed' }) as HeyGenStatusResponse);
    const wait = vi.fn(async () => undefined);

    await expect(
      pollHeyGenUntilDone('vid-4', 'key', { pollIntervalMs: 1000, pollTimeoutMs: 60_000, fetchStatus, wait }),
    ).rejects.toThrow(/sans video_url/);
  });
});

describe('generateAvatarSegment — repli mock', () => {
  it('délègue à la carte titre animée (renderIntroCard) sans HEYGEN_API_KEY, sans appel réseau', async () => {
    mockGetConfig.mockReturnValue({ MOCK_PROVIDERS: false, HEYGEN_API_KEY: undefined });

    const result = await generateAvatarSegment('Bienvenue', 'avatar-1', {
      courseId: 'course-1',
      lessonId: 'lesson-1',
    });

    expect(result.provider).toBe('mock');
    expect(result.seconds).toBeGreaterThan(0);
    expect(result.filePath).toMatch(/segment\.mp4$/);
    expect(mockRenderIntroCard).toHaveBeenCalledWith('course-1', 'lesson-1');
  });

  it('délègue au mock même avec une clé HeyGen si MOCK_PROVIDERS=true', async () => {
    mockGetConfig.mockReturnValue({ MOCK_PROVIDERS: true, HEYGEN_API_KEY: 'sk-heygen-test' });

    const result = await generateAvatarSegment('Bienvenue', 'avatar-1', {
      courseId: 'course-2',
      lessonId: 'lesson-2',
    });

    expect(result.provider).toBe('mock');
    expect(mockRenderIntroCard).toHaveBeenCalledTimes(1);
  });

  it('délègue au mock si avatarId est vide (aucun avatar choisi)', async () => {
    mockGetConfig.mockReturnValue({ MOCK_PROVIDERS: false, HEYGEN_API_KEY: 'sk-heygen-test' });

    const result = await generateAvatarSegment('Bienvenue', '', {
      courseId: 'course-3',
      lessonId: 'lesson-3',
    });

    expect(result.provider).toBe('mock');
  });
});
