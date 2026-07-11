// Tests des primitives PURES du rendu vidéo (Prompt 24) : durées de segment,
// construction des arguments ffmpeg (segment + concat demuxer), fichier de
// liste concat et vérification ffprobe. Aucun I/O, aucun ffmpeg réel.
// Prompt 78 : presets nommés, 2-pass, détection NVENC (mock execa), estimation
// de durée de rendu.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VIDEO } from '../shared.js';
import {
  AUDIO_BITRATE,
  DEFAULT_PRESET,
  PRESET_CONFIG,
  PRESET_SPEED_FACTOR,
  VIDEO_FPS,
  buildConcatArgs,
  buildConcatFile,
  buildSegmentArgs,
  buildTwoPassSegmentArgs,
  detectNvencEncoder,
  estimateRenderDuration,
  expectedDurationSeconds,
  resetNvencCacheForTests,
  resolveEffectivePreset,
  slideSeconds,
  verifyProbe,
  type ProbeSummary,
  type RenderHistorySample,
  type VideoSegment,
} from './video-render.js';

describe('slideSeconds', () => {
  it('retourne la durée audio mesurée quand elle est valide', () => {
    expect(slideSeconds(4.237)).toBe(4.237);
  });

  it('arrondit au millième', () => {
    expect(slideSeconds(2.123456)).toBe(2.123);
  });

  it('retombe sur un plancher quand la durée est absente ou invalide', () => {
    expect(slideSeconds(undefined)).toBe(1);
    expect(slideSeconds(0)).toBe(1);
    expect(slideSeconds(-3)).toBe(1);
    expect(slideSeconds(Number.NaN)).toBe(1);
  });
});

describe('expectedDurationSeconds', () => {
  it('somme les durées des segments (intro incluse)', () => {
    const segments: VideoSegment[] = [
      { imagePath: 'intro.png', audioPath: null, seconds: VIDEO.INTRO_SECONDS },
      { imagePath: 's0.png', audioPath: 'a0.mp3', seconds: 5 },
      { imagePath: 's1.png', audioPath: 'a1.mp3', seconds: 7.5 },
    ];
    expect(expectedDurationSeconds(segments)).toBe(VIDEO.INTRO_SECONDS + 12.5);
  });

  it('vaut 0 pour une liste vide', () => {
    expect(expectedDurationSeconds([])).toBe(0);
  });
});

describe('buildSegmentArgs', () => {
  const audioSeg: VideoSegment = { imagePath: '/tmp/s0.png', audioPath: '/tmp/a0.mp3', seconds: 4.2 };

  it('boucle l\'image, borne la durée et cible H.264 yuv420p 1920×1080 AAC', () => {
    const args = buildSegmentArgs(audioSeg, '/tmp/seg0.mp4');
    expect(args).toContain('-loop');
    expect(args).toContain('/tmp/s0.png');
    expect(args).toContain('/tmp/a0.mp3');
    // Durée bornée à 3 décimales.
    const tIndex = args.indexOf('-t');
    expect(args[tIndex + 1]).toBe('4.200');
    expect(args).toContain('libx264');
    expect(args).toContain('yuv420p');
    expect(args).toContain('aac');
    expect(args).toContain(AUDIO_BITRATE);
    expect(args).toContain(String(VIDEO_FPS));
    // Le scale/pad cible la résolution cible.
    const vf = args[args.indexOf('-vf') + 1] ?? '';
    expect(vf).toContain(`${VIDEO.WIDTH}:${VIDEO.HEIGHT}`);
    // Sortie en dernier argument.
    expect(args[args.length - 1]).toBe('/tmp/seg0.mp4');
  });

  it('synthétise une piste silencieuse (anullsrc) quand la slide n\'a pas d\'audio', () => {
    const silent: VideoSegment = { imagePath: '/tmp/intro.png', audioPath: null, seconds: 3 };
    const args = buildSegmentArgs(silent, '/tmp/intro.mp4');
    expect(args).toContain('lavfi');
    expect(args.some((a) => a.startsWith('anullsrc='))).toBe(true);
    // Même sortie audio AAC : layout de flux homogène pour le concat.
    expect(args).toContain('aac');
  });
});

describe('buildConcatFile', () => {
  it('émet une ligne file par segment, terminée par un saut de ligne', () => {
    const content = buildConcatFile(['/tmp/seg-0.mp4', '/tmp/seg-1.mp4']);
    expect(content).toBe("file '/tmp/seg-0.mp4'\nfile '/tmp/seg-1.mp4'\n");
  });

  it('échappe les apostrophes des chemins', () => {
    const content = buildConcatFile(["/tmp/a'b.mp4"]);
    expect(content).toBe("file '/tmp/a'\\''b.mp4'\n");
  });
});

describe('buildConcatArgs', () => {
  it('utilise le concat demuxer, copie la vidéo et pose +faststart', () => {
    const args = buildConcatArgs('/tmp/concat.txt', '/tmp/out.mp4');
    expect(args).toContain('concat');
    expect(args).toContain('/tmp/concat.txt');
    // Vidéo copiée (coupe franche), audio réencodé AAC.
    const cv = args.indexOf('-c:v');
    expect(args[cv + 1]).toBe('copy');
    expect(args).toContain('aac');
    expect(args).toContain('+faststart');
    expect(args[args.length - 1]).toBe('/tmp/out.mp4');
  });
});

describe('verifyProbe', () => {
  const ok: ProbeSummary = { durationSec: 30, width: VIDEO.WIDTH, height: VIDEO.HEIGHT, hasAudio: true };

  it('accepte un montage conforme (durée dans la tolérance)', () => {
    expect(verifyProbe(ok, 31)).toEqual([]);
    expect(verifyProbe({ ...ok, durationSec: 28 }, 30)).toEqual([]);
  });

  it('signale une durée hors tolérance', () => {
    const problems = verifyProbe({ ...ok, durationSec: 40 }, 30);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/durée/);
  });

  it('signale une mauvaise résolution', () => {
    const problems = verifyProbe({ ...ok, width: 1280, height: 720 }, 30);
    expect(problems.some((p) => /résolution/.test(p))).toBe(true);
  });

  it('signale l\'absence de piste audio', () => {
    const problems = verifyProbe({ ...ok, hasAudio: false }, 30);
    expect(problems.some((p) => /audio/.test(p))).toBe(true);
  });

  it('cumule plusieurs violations', () => {
    const problems = verifyProbe({ durationSec: 99, width: 640, height: 480, hasAudio: false }, 30);
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });
});

/* ------------------------------------------------------------------ */
/* Presets (Prompt 78)                                                  */
/* ------------------------------------------------------------------ */

describe('buildSegmentArgs — presets nommés', () => {
  const seg: VideoSegment = { imagePath: '/tmp/s0.png', audioPath: '/tmp/a0.mp3', seconds: 4.2 };

  it('preset par défaut = DEFAULT_PRESET (final) quand non précisé', () => {
    const withDefault = buildSegmentArgs(seg, '/tmp/out.mp4');
    const withExplicitFinal = buildSegmentArgs(seg, '/tmp/out.mp4', 'final');
    expect(withDefault).toEqual(withExplicitFinal);
    expect(DEFAULT_PRESET).toBe('final');
  });

  it('draft : x264 veryfast CRF 21', () => {
    const args = buildSegmentArgs(seg, '/tmp/out.mp4', 'draft');
    expect(args).toContain('libx264');
    expect(args[args.indexOf('-preset') + 1]).toBe('veryfast');
    expect(args[args.indexOf('-crf') + 1]).toBe('21');
  });

  it('final : x264 slow CRF 19', () => {
    const args = buildSegmentArgs(seg, '/tmp/out.mp4', 'final');
    expect(args).toContain('libx264');
    expect(args[args.indexOf('-preset') + 1]).toBe('slow');
    expect(args[args.indexOf('-crf') + 1]).toBe('19');
  });

  it('nvenc : h264_nvenc avec -rc/-cq, pas de -crf', () => {
    const args = buildSegmentArgs(seg, '/tmp/out.mp4', 'nvenc');
    expect(args).toContain('h264_nvenc');
    expect(args).toContain('-rc');
    expect(args).toContain('-cq');
    expect(args).not.toContain('-crf');
  });

  it('PRESET_CONFIG couvre les 3 presets attendus par la spec (draft/final/nvenc)', () => {
    expect(Object.keys(PRESET_CONFIG).sort()).toEqual(['draft', 'final', 'nvenc']);
    expect(PRESET_CONFIG.draft).toMatchObject({ codec: 'libx264', x264Preset: 'veryfast', crf: 21 });
    expect(PRESET_CONFIG.final).toMatchObject({ codec: 'libx264', x264Preset: 'slow', crf: 19 });
    expect(PRESET_CONFIG.nvenc.codec).toBe('h264_nvenc');
  });
});

describe('buildTwoPassSegmentArgs', () => {
  const seg: VideoSegment = { imagePath: '/tmp/s0.png', audioPath: '/tmp/a0.mp3', seconds: 4.2 };

  it('passe 1 : analyse sans audio, sortie jetée (null muxer)', () => {
    const args = buildTwoPassSegmentArgs(seg, '/tmp/out.mp4', 'final', 1, '/tmp/pass.log');
    expect(args).toContain('-pass');
    expect(args[args.indexOf('-pass') + 1]).toBe('1');
    expect(args).toContain('-an');
    expect(args).not.toContain('/tmp/a0.mp3');
    expect(args[args.length - 1]).not.toBe('/tmp/out.mp4');
  });

  it('passe 2 : ré-injecte l\'audio et écrit la sortie réelle', () => {
    const args = buildTwoPassSegmentArgs(seg, '/tmp/out.mp4', 'final', 2, '/tmp/pass.log');
    expect(args[args.indexOf('-pass') + 1]).toBe('2');
    expect(args).toContain('/tmp/a0.mp3');
    expect(args).toContain('aac');
    expect(args[args.length - 1]).toBe('/tmp/out.mp4');
  });

  it('les deux passes partagent le même -passlogfile', () => {
    const p1 = buildTwoPassSegmentArgs(seg, '/tmp/out.mp4', 'final', 1, '/tmp/shared.log');
    const p2 = buildTwoPassSegmentArgs(seg, '/tmp/out.mp4', 'final', 2, '/tmp/shared.log');
    expect(p1[p1.indexOf('-passlogfile') + 1]).toBe('/tmp/shared.log');
    expect(p2[p2.indexOf('-passlogfile') + 1]).toBe('/tmp/shared.log');
  });

  it('nvenc : pas de 2-pass utile, retombe sur les arguments 1-passe standard', () => {
    const twoPass = buildTwoPassSegmentArgs(seg, '/tmp/out.mp4', 'nvenc', 1, '/tmp/pass.log');
    const onePass = buildSegmentArgs(seg, '/tmp/out.mp4', 'nvenc');
    expect(twoPass).toEqual(onePass);
  });
});

/* ------------------------------------------------------------------ */
/* Détection NVENC (mock execa)                                        */
/* ------------------------------------------------------------------ */

vi.mock('execa', () => ({ execa: vi.fn() }));

describe('detectNvencEncoder', () => {
  afterEach(async () => {
    resetNvencCacheForTests();
    vi.resetAllMocks();
  });

  it('détecte NVENC quand h264_nvenc figure dans la sortie ffmpeg -encoders', async () => {
    const { execa } = await import('execa');
    vi.mocked(execa).mockResolvedValue({
      stdout: 'V..... h264_nvenc  NVIDIA NVENC H.264 encoder\nV..... libx264    libx264 H.264',
    } as never);

    await expect(detectNvencEncoder()).resolves.toBe(true);
  });

  it('renvoie false quand h264_nvenc est absent de la sortie', async () => {
    const { execa } = await import('execa');
    vi.mocked(execa).mockResolvedValue({
      stdout: 'V..... libx264    libx264 H.264',
    } as never);

    await expect(detectNvencEncoder()).resolves.toBe(false);
  });

  it('fallback silencieux à false si ffmpeg est absent/échoue (ne jette jamais)', async () => {
    const { execa } = await import('execa');
    vi.mocked(execa).mockRejectedValue(new Error('command not found: ffmpeg'));

    await expect(detectNvencEncoder()).resolves.toBe(false);
  });

  it('met le résultat en cache (un seul appel execa pour deux détections)', async () => {
    const { execa } = await import('execa');
    vi.mocked(execa).mockResolvedValue({ stdout: 'h264_nvenc' } as never);

    await detectNvencEncoder();
    await detectNvencEncoder();
    expect(execa).toHaveBeenCalledTimes(1);
  });
});

describe('resolveEffectivePreset', () => {
  afterEach(async () => {
    resetNvencCacheForTests();
    vi.resetAllMocks();
  });

  it('draft/final : retournés tels quels, sans détection GPU', async () => {
    await expect(resolveEffectivePreset('draft')).resolves.toBe('draft');
    await expect(resolveEffectivePreset('final')).resolves.toBe('final');
  });

  it('nvenc : conservé si le GPU est disponible', async () => {
    const { execa } = await import('execa');
    vi.mocked(execa).mockResolvedValue({ stdout: 'h264_nvenc' } as never);

    await expect(resolveEffectivePreset('nvenc')).resolves.toBe('nvenc');
  });

  it('nvenc : retombe sur final si le GPU est indisponible', async () => {
    const { execa } = await import('execa');
    vi.mocked(execa).mockResolvedValue({ stdout: 'libx264' } as never);

    await expect(resolveEffectivePreset('nvenc')).resolves.toBe('final');
  });
});

/* ------------------------------------------------------------------ */
/* Estimation de durée de rendu (pure)                                  */
/* ------------------------------------------------------------------ */

describe('estimateRenderDuration', () => {
  it('retourne 0 pour un nombre de slides nul ou invalide', () => {
    expect(estimateRenderDuration(0, 'final')).toBe(0);
    expect(estimateRenderDuration(-2, 'final')).toBe(0);
    expect(estimateRenderDuration(Number.NaN, 'final')).toBe(0);
  });

  it('sans historique : repère fixe ajusté par la vitesse du preset (draft < final)', () => {
    const draft = estimateRenderDuration(10, 'draft');
    const final = estimateRenderDuration(10, 'final');
    expect(draft).toBeLessThan(final);
    expect(draft).toBeGreaterThan(0);
  });

  it('nvenc sans historique est plus rapide que final (facteur de vitesse)', () => {
    const nvenc = estimateRenderDuration(10, 'nvenc');
    const final = estimateRenderDuration(10, 'final');
    expect(nvenc).toBeLessThan(final);
  });

  it('utilise la moyenne ms/slide du MÊME preset quand l\'historique est disponible', () => {
    const history: RenderHistorySample[] = [
      { totalSlides: 10, preset: 'final', durationMs: 100_000 },
      { totalSlides: 20, preset: 'final', durationMs: 180_000 },
    ];
    // Moyenne ms/slide = (10000 + 9000) / 2 = 9500 → pour 5 slides = 47500
    expect(estimateRenderDuration(5, 'final', history)).toBe(47_500);
  });

  it('convertit un historique d\'un AUTRE preset via le ratio de vitesse', () => {
    const history: RenderHistorySample[] = [
      { totalSlides: 10, preset: 'draft', durationMs: 30_000 },
    ];
    // ms/slide draft = 3000 ; normalisé (× facteur draft) = 3000 × PRESET_SPEED_FACTOR.draft
    // puis reconverti pour 'final' (÷ facteur final = 1).
    const expectedPerSlide = (3000 * PRESET_SPEED_FACTOR.draft) / PRESET_SPEED_FACTOR.final;
    expect(estimateRenderDuration(4, 'final', history)).toBe(Math.round(expectedPerSlide * 4));
  });

  it('ignore les échantillons incohérents (durationMs ou totalSlides <= 0)', () => {
    const history: RenderHistorySample[] = [
      { totalSlides: 0, preset: 'final', durationMs: 100_000 },
      { totalSlides: 10, preset: 'final', durationMs: 0 },
    ];
    // Aucun échantillon exploitable → repère fixe (identique à un historique vide).
    expect(estimateRenderDuration(10, 'final', history)).toBe(estimateRenderDuration(10, 'final', []));
  });
});
