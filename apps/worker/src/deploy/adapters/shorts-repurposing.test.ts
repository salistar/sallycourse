// Tests de la logique PURE du repurposing courts (aucun réseau/ffmpeg réel) :
// détection des passages denses, sélection des meilleurs segments, arguments
// ffmpeg de recadrage 9:16, sous-titres karaoké, calendrier de publication.
import { describe, expect, it } from 'vitest';
import {
  scoreSlideDensity,
  detectDenseSegments,
  selectTopSegments,
  buildCropArgs,
  deriveWordTimings,
  buildKaraokeAss,
  buildBurnSubtitlesArgs,
  buildPublishSchedule,
  SHORTS,
} from './shorts-repurposing.js';
import type { Slide, SlideScript } from '../../shared.js';

function makeSlide(overrides: Partial<Slide> = {}): Slide {
  return {
    template: 'content',
    title: 'Titre',
    bullets: [],
    narration: 'Une narration simple sans grand intérêt particulier ici.',
    ...overrides,
  };
}

describe('scoreSlideDensity', () => {
  it('donne un score plus élevé à une slide riche en bullets et mots-clés', () => {
    const sparse = makeSlide({ narration: 'On va voir un peu de choses.' });
    const dense = makeSlide({
      narration:
        'TypeScript impose un typage statique strict qui élimine des catégories entières de bugs runtime critiques.',
      bullets: ['Typage statique', 'Sécurité accrue', 'Moins de bugs', 'Meilleure DX'],
      template: 'comparison',
    });
    expect(scoreSlideDensity(dense)).toBeGreaterThan(scoreSlideDensity(sparse));
  });

  it('retourne 0 pour une narration vide en pratique (mots filtrés)', () => {
    const slide = makeSlide({ narration: 'à' });
    expect(scoreSlideDensity(slide)).toBeGreaterThanOrEqual(0);
  });

  it('est déterministe (même entrée → même score)', () => {
    const slide = makeSlide({ narration: 'Le cache Redis accélère fortement les lectures répétées.' });
    expect(scoreSlideDensity(slide)).toBe(scoreSlideDensity(slide));
  });
});

describe('detectDenseSegments', () => {
  it('produit un segment par slide avec des offsets cumulés', () => {
    const script: SlideScript = {
      slides: [
        makeSlide({ audioSeconds: 10 }),
        makeSlide({ audioSeconds: 20 }),
        makeSlide({ audioSeconds: 5 }),
      ],
    };
    const segments = detectDenseSegments(script);
    expect(segments).toHaveLength(3);
    expect(segments[0]!.startSec).toBe(0);
    expect(segments[0]!.endSec).toBe(10);
    expect(segments[1]!.startSec).toBe(10);
    expect(segments[1]!.endSec).toBe(30);
    expect(segments[2]!.startSec).toBe(30);
    expect(segments[2]!.endSec).toBe(35);
  });

  it('décale les offsets avec introSeconds', () => {
    const script: SlideScript = { slides: [makeSlide({ audioSeconds: 10 })] };
    const segments = detectDenseSegments(script, 4);
    expect(segments[0]!.startSec).toBe(4);
    expect(segments[0]!.endSec).toBe(14);
  });

  it('borne la durée du segment à MAX_CLIP_SECONDS même si la slide est plus longue', () => {
    const script: SlideScript = { slides: [makeSlide({ audioSeconds: 120 })] };
    const segments = detectDenseSegments(script);
    expect(segments[0]!.endSec - segments[0]!.startSec).toBe(SHORTS.MAX_CLIP_SECONDS);
  });

  it('utilise une durée plancher de 1s si audioSeconds absent', () => {
    const script: SlideScript = { slides: [makeSlide({ audioSeconds: undefined })] };
    const segments = detectDenseSegments(script);
    expect(segments[0]!.endSec - segments[0]!.startSec).toBe(1);
  });
});

describe('selectTopSegments', () => {
  it('retient les N meilleurs segments par score et les remet dans l’ordre chronologique', () => {
    const segments = [
      { slideIndex: 0, startSec: 0, endSec: 5, score: 1, narration: 'a' },
      { slideIndex: 1, startSec: 5, endSec: 10, score: 9, narration: 'b' },
      { slideIndex: 2, startSec: 10, endSec: 15, score: 5, narration: 'c' },
    ];
    const top = selectTopSegments(segments, 2);
    expect(top.map((s) => s.slideIndex)).toEqual([1, 2]);
  });

  it('retourne tout si moins de segments que le maximum demandé', () => {
    const segments = [{ slideIndex: 0, startSec: 0, endSec: 5, score: 1, narration: 'a' }];
    expect(selectTopSegments(segments, 30)).toHaveLength(1);
  });

  it('ne jette jamais sur un tableau vide', () => {
    expect(selectTopSegments([], 30)).toEqual([]);
  });
});

describe('buildCropArgs', () => {
  it('inclut -ss avant -i (seek rapide) et la durée calculée', () => {
    const args = buildCropArgs('/tmp/in.mp4', '/tmp/out.mp4', 10, 25);
    const iIndex = args.indexOf('-i');
    const ssIndex = args.indexOf('-ss');
    expect(ssIndex).toBeGreaterThanOrEqual(0);
    expect(ssIndex).toBeLessThan(iIndex);
    const tIndex = args.indexOf('-t');
    expect(args[tIndex + 1]).toBe('15.000');
  });

  it('applique un crop 9:16 centré et une résolution cible portrait', () => {
    const args = buildCropArgs('/tmp/in.mp4', '/tmp/out.mp4', 0, 20, 1080, 1920);
    const vfIndex = args.indexOf('-vf');
    expect(args[vfIndex + 1]).toContain('crop=ih*9/16:ih');
    expect(args[vfIndex + 1]).toContain('scale=1080:1920');
  });

  it('borne la durée à un minimum non nul même si start >= end', () => {
    const args = buildCropArgs('/tmp/in.mp4', '/tmp/out.mp4', 10, 10);
    const tIndex = args.indexOf('-t');
    expect(Number(args[tIndex + 1])).toBeGreaterThan(0);
  });
});

describe('deriveWordTimings', () => {
  it('répartit la durée totale proportionnellement à la longueur des mots', () => {
    const timings = deriveWordTimings('un chat', 10);
    expect(timings).toHaveLength(2);
    expect(timings[0]!.startSec).toBe(0);
    expect(timings[timings.length - 1]!.endSec).toBeCloseTo(10, 1);
  });

  it('retourne un tableau vide si narration vide ou durée nulle', () => {
    expect(deriveWordTimings('', 10)).toEqual([]);
    expect(deriveWordTimings('mot', 0)).toEqual([]);
  });

  it('les timings sont chronologiquement croissants et contigus', () => {
    const timings = deriveWordTimings('le chat mange la souris rapidement', 12);
    for (let i = 1; i < timings.length; i += 1) {
      expect(timings[i]!.startSec).toBeCloseTo(timings[i - 1]!.endSec, 3);
    }
  });
});

describe('buildKaraokeAss', () => {
  it('produit un événement Dialogue par mot, en majuscules', () => {
    const timings = deriveWordTimings('bonjour tout le monde', 4);
    const ass = buildKaraokeAss(timings);
    expect(ass).toContain('[Script Info]');
    expect(ass).toContain('[Events]');
    expect(ass).toContain('BONJOUR');
    expect((ass.match(/Dialogue:/g) ?? []).length).toBe(timings.length);
  });

  it('échappe les accolades pour ne pas casser le rendu ASS', () => {
    const ass = buildKaraokeAss([{ word: 'a{b}c', startSec: 0, endSec: 1 }]);
    expect(ass).not.toContain('{');
    expect(ass).not.toContain('}');
  });
});

describe('buildBurnSubtitlesArgs', () => {
  it('échappe les deux-points du chemin Windows dans le filtre ass=', () => {
    const args = buildBurnSubtitlesArgs('C:/tmp/in.mp4', 'C:\\tmp\\sub.ass', 'C:/tmp/out.mp4');
    const vfIndex = args.indexOf('-vf');
    expect(args[vfIndex + 1]).toBe('ass=C\\:/tmp/sub.ass');
  });
});

describe('buildPublishSchedule', () => {
  it('espace les clips de intervalHours heures à partir de startAt', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const schedule = buildPublishSchedule(3, start, 6);
    expect(schedule).toHaveLength(3);
    expect(schedule[0]!.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(schedule[1]!.toISOString()).toBe('2026-01-01T06:00:00.000Z');
    expect(schedule[2]!.toISOString()).toBe('2026-01-01T12:00:00.000Z');
  });

  it('retourne un tableau vide pour 0 clip', () => {
    expect(buildPublishSchedule(0)).toEqual([]);
  });
});
