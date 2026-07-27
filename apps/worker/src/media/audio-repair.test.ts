// Tests des primitives PURES de réparation audio (Lot 2, plan 2026-07-20) :
// reconstruction des plages de slides, parsing silencedetect, attribution des
// trous. Aucune I/O (ffmpeg réel testé ailleurs via le processor/intégration).
import { describe, expect, it } from 'vitest';
import {
  attributeGapsToSlides,
  computeSlideAudioRanges,
  parseSilenceDetect,
  type SilenceGap,
} from './audio-repair.js';

describe('computeSlideAudioRanges', () => {
  it('cumule les durées bout à bout, décalées par introSeconds', () => {
    const ranges = computeSlideAudioRanges(
      [{ audioSeconds: 10 }, { audioSeconds: 5 }, { audioSeconds: 20 }],
      3,
    );
    expect(ranges).toEqual([
      { index: 0, start: 3, end: 13 },
      { index: 1, start: 13, end: 18 },
      { index: 2, start: 18, end: 38 },
    ]);
  });

  it('traite une slide sans audioSeconds comme durée nulle (ne décale pas les suivantes indûment)', () => {
    const ranges = computeSlideAudioRanges([{ audioSeconds: 10 }, {}, { audioSeconds: 5 }], 0);
    expect(ranges[1]).toEqual({ index: 1, start: 10, end: 10 });
    expect(ranges[2]).toEqual({ index: 2, start: 10, end: 15 });
  });

  it('introSeconds par défaut = VIDEO.INTRO_SECONDS (3s)', () => {
    const ranges = computeSlideAudioRanges([{ audioSeconds: 10 }]);
    expect(ranges[0]!.start).toBe(3);
  });
});

describe('parseSilenceDetect', () => {
  it('extrait les paires start/end en secondes depuis une sortie ffmpeg réelle', () => {
    const stderr = [
      '[silencedetect @ 0x55f] silence_start: 14.16',
      '[silencedetect @ 0x55f] silence_end: 15.95 | silence_duration: 1.79',
      '[silencedetect @ 0x55f] silence_start: 186.55',
      '[silencedetect @ 0x55f] silence_end: 188.74 | silence_duration: 2.19',
    ].join('\n');
    expect(parseSilenceDetect(stderr)).toEqual([
      { start: 14.16, end: 15.95 },
      { start: 186.55, end: 188.74 },
    ]);
  });

  it('ignore un silence_start orphelin (silence jusqu’à la fin du flux)', () => {
    const stderr = '[silencedetect] silence_start: 90.0\n';
    expect(parseSilenceDetect(stderr)).toEqual([]);
  });

  it('retourne un tableau vide si aucun silence détecté', () => {
    expect(parseSilenceDetect('juste du bruit ffmpeg, rien à voir')).toEqual([]);
  });
});

describe('attributeGapsToSlides (correctif Lot 2 — méthodologie de l’audit 2026-07-20)', () => {
  const ranges = computeSlideAudioRanges(
    [{ audioSeconds: 20 }, { audioSeconds: 30 }, { audioSeconds: 15 }],
    3,
  );
  // ranges: slide0 [3,23], slide1 [23,53], slide2 [53,68]

  it('signale un trou franchement interne à une slide (cas réel : dead-air mi-phrase)', () => {
    const gaps: SilenceGap[] = [{ start: 30, end: 33.09 }]; // bien dans slide1 [23,53]
    expect(attributeGapsToSlides(gaps, ranges)).toEqual([1]);
  });

  it("ne signale PAS un trou de transition normal entre deux slides (touche la frontière)", () => {
    const gaps: SilenceGap[] = [{ start: 22.9, end: 23.1 }]; // chevauche la frontière slide0/slide1
    expect(attributeGapsToSlides(gaps, ranges)).toEqual([]);
  });

  it('un long trou entièrement contenu dans une slide reste attribué à celle-ci seule', () => {
    const gaps: SilenceGap[] = [{ start: 24, end: 52 }]; // presque toute slide1 [23,53], jamais slide0/slide2
    expect(attributeGapsToSlides(gaps, ranges)).toEqual([1]);
  });

  it('accumule plusieurs trous sur plusieurs slides sans doublon', () => {
    const gaps: SilenceGap[] = [
      { start: 5, end: 6 }, // slide0
      { start: 40, end: 41 }, // slide1
      { start: 41, end: 42 }, // slide1 encore
      { start: 60, end: 61 }, // slide2
    ];
    expect(attributeGapsToSlides(gaps, ranges)).toEqual([0, 1, 2]);
  });

  it('ignore les trous hors de toute plage (ex. avant introSeconds)', () => {
    expect(attributeGapsToSlides([{ start: 0, end: 1 }], ranges)).toEqual([]);
  });
});
