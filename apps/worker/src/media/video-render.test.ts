// Tests des primitives PURES du rendu vidéo (Prompt 24) : durées de segment,
// construction des arguments ffmpeg (segment + concat demuxer), fichier de
// liste concat et vérification ffprobe. Aucun I/O, aucun ffmpeg réel.
import { describe, expect, it } from 'vitest';
import { VIDEO } from '../shared.js';
import {
  AUDIO_BITRATE,
  VIDEO_FPS,
  buildConcatArgs,
  buildConcatFile,
  buildSegmentArgs,
  expectedDurationSeconds,
  slideSeconds,
  verifyProbe,
  type ProbeSummary,
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
