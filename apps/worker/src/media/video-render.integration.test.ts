// Test d'intégration RÉEL du rendu vidéo (Prompt 67) : contrairement à
// video-render.test.ts (helpers purs, aucun I/O), ce fichier invoque VRAIMENT
// ffmpeg pour assembler une mini-leçon (2 slides synthétiques) et vérifie le
// MP4 produit via ffprobe — bout en bout sur le pipeline segment→concat→probe.
//
// Aucune dépendance Mongo/S3/Playwright : les images/audio sont générées à la
// volée par ffmpeg lui-même (lavfi), donc le test ne consomme aucune fixture
// binaire versionnée. Guard explicite : si ffmpeg/ffprobe sont absents du
// PATH (poste CI minimal), la suite est SKIPPÉE proprement (pas d'échec).
import { execa } from 'execa';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VIDEO } from '../shared.js';
import {
  buildConcatArgs,
  buildConcatFile,
  buildSegmentArgs,
  expectedDurationSeconds,
  probeVideo,
  verifyProbe,
  type VideoSegment,
} from './video-render.js';

/** Détecte ffmpeg + ffprobe sans jeter si l'un des deux est absent du PATH. */
async function ffmpegAvailable(): Promise<boolean> {
  try {
    await execa('ffmpeg', ['-version']);
    await execa('ffprobe', ['-version']);
    return true;
  } catch {
    return false;
  }
}

/** Génère une image PNG unie via le filtre lavfi color (aucun asset requis). */
async function makeSyntheticImage(dest: string, color: string): Promise<void> {
  await execa('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=${color}:s=${VIDEO.WIDTH}x${VIDEO.HEIGHT}:d=1`,
    '-frames:v',
    '1',
    dest,
  ]);
}

/** Génère un mp3 de tonalité courte via le générateur de sinus lavfi. */
async function makeSyntheticAudio(dest: string, seconds: number): Promise<void> {
  await execa('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:duration=${seconds}`,
    '-c:a',
    'libmp3lame',
    dest,
  ]);
}

describe('renderLessonVideo — intégration ffmpeg réelle (mini-leçon 2 slides)', () => {
  let available = false;
  let dir = '';

  beforeAll(async () => {
    available = await ffmpegAvailable();
    if (!available) return;
    dir = await mkdtemp(path.join(tmpdir(), 'video-render-it-'));
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  it(
    'assemble intro + 2 slides en un MP4 conforme (résolution, durée, audio)',
    async (ctx) => {
      // ffmpeg/ffprobe absents du PATH (poste CI minimal) : skip PROPRE et
      // visible dans le rapport (ni échec, ni faux « passed » silencieux).
      if (!available) {
        ctx.skip();
        return;
      }

      // ── 1) Prépare les assets synthétiques (aucun fichier versionné) ──
      const introImage = path.join(dir, 'intro.png');
      await makeSyntheticImage(introImage, 'black');

      const slide0Image = path.join(dir, 'slide-0.png');
      const slide0Audio = path.join(dir, 'audio-0.mp3');
      await Promise.all([
        makeSyntheticImage(slide0Image, 'navy'),
        makeSyntheticAudio(slide0Audio, 1.2),
      ]);

      const slide1Image = path.join(dir, 'slide-1.png');
      const slide1Audio = path.join(dir, 'audio-1.mp3');
      await Promise.all([
        makeSyntheticImage(slide1Image, 'maroon'),
        makeSyntheticAudio(slide1Audio, 0.8),
      ]);

      const segments: VideoSegment[] = [
        { imagePath: introImage, audioPath: null, seconds: VIDEO.INTRO_SECONDS },
        { imagePath: slide0Image, audioPath: slide0Audio, seconds: 1.2 },
        { imagePath: slide1Image, audioPath: slide1Audio, seconds: 0.8 },
      ];

      // ── 2) Encode chaque segment (même chemin que renderLessonVideo) ──
      const segmentPaths: string[] = [];
      for (let i = 0; i < segments.length; i += 1) {
        const out = path.join(dir, `seg-${i}.mp4`);
        await execa('ffmpeg', buildSegmentArgs(segments[i]!, out));
        segmentPaths.push(out);
      }

      // ── 3) Concat demuxer → MP4 final ──
      const concatList = path.join(dir, 'concat.txt');
      await writeFile(concatList, buildConcatFile(segmentPaths), 'utf8');
      const finalPath = path.join(dir, 'lesson.mp4');
      await execa('ffmpeg', buildConcatArgs(concatList, finalPath));

      // ── 4) Vérification ffprobe RÉELLE (pas un ProbeSummary simulé) ──
      const probe = await probeVideo(finalPath);
      const expected = expectedDurationSeconds(segments);
      const problems = verifyProbe(probe, expected);

      expect(problems).toEqual([]);
      expect(probe.width).toBe(VIDEO.WIDTH);
      expect(probe.height).toBe(VIDEO.HEIGHT);
      expect(probe.hasAudio).toBe(true);
      expect(probe.durationSec).toBeGreaterThan(0);
    },
    30_000,
  );
});
