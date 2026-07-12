// Tests des primitives de sous-titrage (Prompt 25) : formatage des timestamps,
// sérialisation SRT/VTT, alignement transcription ↔ script, repli déterministe.
import { describe, expect, it } from 'vitest';
import { AUDIO } from '../shared.js';
import {
  alignToReference,
  estimateNarrationSeconds,
  formatSrtTimestamp,
  formatVttTimestamp,
  normalizeWords,
  subtitlesFromScript,
  toPlainText,
  toSrt,
  toVtt,
  type Cue,
  type WhisperSegment,
} from './subtitles.js';

describe('formatage des timestamps', () => {
  it('formate le SRT avec une virgule pour les millisecondes', () => {
    expect(formatSrtTimestamp(0)).toBe('00:00:00,000');
    expect(formatSrtTimestamp(1.5)).toBe('00:00:01,500');
    expect(formatSrtTimestamp(3661.234)).toBe('01:01:01,234');
  });

  it('formate le VTT avec un point pour les millisecondes', () => {
    expect(formatVttTimestamp(0)).toBe('00:00:00.000');
    expect(formatVttTimestamp(1.5)).toBe('00:00:01.500');
    expect(formatVttTimestamp(3661.234)).toBe('01:01:01.234');
  });

  it('borne les temps négatifs à zéro', () => {
    expect(formatSrtTimestamp(-2)).toBe('00:00:00,000');
  });
});

describe('toSrt', () => {
  const cues: Cue[] = [
    { start: 0, end: 2.5, text: 'Bonjour' },
    { start: 2.5, end: 5, text: 'et bienvenue' },
  ];

  it('numérote les blocs à partir de 1 et sépare par une ligne vide', () => {
    const srt = toSrt(cues);
    expect(srt).toContain('1\n00:00:00,000 --> 00:00:02,500\nBonjour');
    expect(srt).toContain('2\n00:00:02,500 --> 00:00:05,000\net bienvenue');
    expect(srt).toContain('\n\n');
  });

  it('ignore les cues au texte vide et trie chronologiquement', () => {
    const srt = toSrt([
      { start: 4, end: 6, text: 'deux' },
      { start: 0, end: 2, text: 'un' },
      { start: 6, end: 8, text: '   ' },
    ]);
    const firstText = srt.split('\n')[2];
    expect(firstText).toBe('un');
    expect(srt).not.toContain('3\n');
  });
});

describe('toVtt', () => {
  it('émet l’en-tête WEBVTT et des timestamps à point', () => {
    const vtt = toVtt([{ start: 0, end: 1, text: 'Salut' }]);
    expect(vtt.startsWith('WEBVTT\n\n')).toBe(true);
    expect(vtt).toContain('00:00:00.000 --> 00:00:01.000\nSalut');
  });
});

describe('toPlainText', () => {
  it('un paragraphe par cue, sans timestamp ni index (P137)', () => {
    const txt = toPlainText([
      { start: 0, end: 2.5, text: 'Bonjour' },
      { start: 2.5, end: 5, text: 'et bienvenue' },
    ]);
    expect(txt).toBe('Bonjour\n\net bienvenue\n');
    expect(txt).not.toMatch(/\d{2}:\d{2}:\d{2}/); // aucun timestamp
    expect(txt).not.toMatch(/^\d+$/m); // aucun index de bloc
  });

  it('ignore les cues au texte vide et trie chronologiquement comme toSrt/toVtt', () => {
    const txt = toPlainText([
      { start: 5, end: 6, text: 'plus tard' },
      { start: 0, end: 1, text: '  ' },
      { start: 1, end: 2, text: 'plus tôt' },
    ]);
    expect(txt).toBe('plus tôt\n\nplus tard\n');
  });
});

describe('normalizeWords', () => {
  it('minuscule, retire ponctuation et diacritiques', () => {
    expect(normalizeWords('Créez, testez !')).toEqual(['creez', 'testez']);
  });
});

describe('alignToReference', () => {
  const segments: WhisperSegment[] = [
    { start: 0, end: 2, text: 'les klosures en javascript' }, // texte Whisper approximatif
    { start: 2, end: 4, text: 'capture le contexte' },
  ];
  const narration = ['Les closures en JavaScript.', 'Elles capturent le contexte lexical.'];

  it('conserve les timestamps des segments', () => {
    const cues = alignToReference(segments, narration);
    expect(cues).toHaveLength(2);
    expect(cues[0]!.start).toBe(0);
    expect(cues[0]!.end).toBe(2);
    expect(cues[1]!.start).toBe(2);
    expect(cues[1]!.end).toBe(4);
  });

  it('remplace le texte transcrit par le texte source (exact)', () => {
    const cues = alignToReference(segments, narration);
    const joined = cues.map((c) => c.text).join(' ');
    // Tous les mots de référence sont présents et bien orthographiés.
    expect(joined).toContain('closures');
    expect(joined).toContain('JavaScript');
    expect(joined).toContain('lexical');
    expect(joined).not.toContain('klosures');
  });

  it('n’oublie aucun mot de référence (dernier cue récupère le reste)', () => {
    const cues = alignToReference(segments, narration);
    const referenceWordCount = narration.join(' ').split(/\s+/).length;
    const outputWordCount = cues.map((c) => c.text).join(' ').split(/\s+/).length;
    expect(outputWordCount).toBe(referenceWordCount);
  });

  it('retombe sur le texte Whisper si la référence est vide', () => {
    const cues = alignToReference(segments, []);
    expect(cues[0]!.text).toBe('les klosures en javascript');
  });

  it('retourne [] sans segment exploitable', () => {
    expect(alignToReference([], narration)).toEqual([]);
  });
});

describe('subtitlesFromScript (repli)', () => {
  it('un cue par slide, texte exact, calé bout à bout sur audioSeconds', () => {
    const cues = subtitlesFromScript([
      { narration: 'Première slide.', audioSeconds: 3 },
      { narration: 'Deuxième slide.', audioSeconds: 4 },
    ]);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ start: 0, end: 3, text: 'Première slide.' });
    expect(cues[1]).toEqual({ start: 3, end: 7, text: 'Deuxième slide.' });
  });

  it('estime la durée depuis le débit AUDIO quand audioSeconds est absent', () => {
    const narration = Array.from({ length: AUDIO.NARRATION_WORDS_PER_MINUTE }, () => 'mot').join(' ');
    const [cue] = subtitlesFromScript([{ narration }]);
    // ~140 mots au débit de 140 mots/min → ~60 s.
    expect(cue!.end).toBeCloseTo(60, 0);
  });

  it('ignore les narrations vides', () => {
    expect(subtitlesFromScript([{ narration: '   ' }])).toEqual([]);
  });
});

describe('estimateNarrationSeconds', () => {
  it('plancher à 1 seconde', () => {
    expect(estimateNarrationSeconds('mot')).toBeGreaterThanOrEqual(1);
  });
});
