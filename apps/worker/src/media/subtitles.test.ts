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
  realignCues,
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

describe('realignCues (lisibilité)', () => {
  const dur = (c: Cue) => c.end - c.start;

  it('fusionne un mot orphelin dans le cue précédent', () => {
    const out = realignCues([
      { start: 0, end: 2.5, text: 'Voici la première phrase complète' },
      { start: 2.5, end: 2.52, text: 'suivante' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe('Voici la première phrase complète suivante');
  });

  it('étire un cue trop court dans le silence qui suit (≥1 s)', () => {
    const out = realignCues([
      { start: 0, end: 0.02, text: 'Bonjour tout le monde' },
      { start: 10, end: 12, text: 'Bien plus tard une autre phrase ici' },
    ]);
    expect(dur(out[0]!)).toBeGreaterThanOrEqual(1);
  });

  it('découpe un cue trop long (>6 s) aux frontières de mots', () => {
    const words = Array.from({ length: 40 }, (_, i) => `mot${i}`).join(' ');
    const out = realignCues([{ start: 0, end: 22, text: words }]);
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) expect(dur(c)).toBeLessThanOrEqual(6.5);
    // Aucun mot perdu ni dupliqué à la découpe.
    expect(out.map((c) => c.text).join(' ').split(/\s+/)).toHaveLength(40);
  });

  it('ralentit un affichage trop rapide en étirant dans le silence', () => {
    // 60 caractères en 0,8 s ≈ 75 cps : bien au-dessus de 17 cps.
    const out = realignCues([
      { start: 0, end: 0.8, text: 'a'.repeat(30) + ' ' + 'b'.repeat(29) },
      { start: 30, end: 32, text: 'phrase de queue bien distincte plus loin' },
    ]);
    const cps = out[0]!.text.length / dur(out[0]!);
    expect(cps).toBeLessThanOrEqual(17.5);
  });

  it('découpe un cue trop dense (>15 mots) même de durée courte (E4, audit ESG 2026-07-19)', () => {
    // Durée normale (3 s) mais 20 mots fusionnés (étape 1) : sans plafond mot,
    // MAX_CPS seul ne détecte pas ce cas si le texte reste sous 17 cps de
    // moyenne — le cue affiche pourtant 20 mots d'un coup, illisible.
    const words = Array.from({ length: 20 }, (_, i) => `m${i}`).join(' ');
    const out = realignCues([{ start: 0, end: 3, text: words }]);
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) {
      expect(c.text.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(15);
    }
    // Aucun mot perdu ni dupliqué à la découpe.
    expect(out.map((c) => c.text).join(' ').split(/\s+/)).toHaveLength(20);
  });

  it('est idempotent', () => {
    const once = realignCues([
      { start: 0, end: 0.02, text: 'un' },
      { start: 0.02, end: 25, text: Array.from({ length: 50 }, (_, i) => `w${i}`).join(' ') },
    ]);
    expect(realignCues(once)).toEqual(once);
  });

  describe('correctif 1.4 (audit 2026-07-20) — étirement même sans silence disponible', () => {
    it('repousse le cue suivant quand les cues sont posés bout à bout (aucun silence à voler)', () => {
      // Reproduit exactement le défaut mesuré : cues Whisper contigus (pas de
      // gap), un cue trop court/dense ne pouvait auparavant JAMAIS atteindre
      // MIN_CUE_SEC — le plafond `next.start - MIN_GAP_SEC` égalait cur.end.
      const out = realignCues([
        { start: 0, end: 0.3, text: 'Bonjour et bienvenue dans cette leçon' }, // 6 mots en 0,3s ≈ 1200 wpm
        { start: 0.3, end: 3.3, text: 'La suite de la phrase continue ici normalement' },
      ]);
      expect(dur(out[0]!)).toBeGreaterThanOrEqual(1); // MIN_CUE_SEC désormais réellement appliqué.
      // cur.start du premier cue reste ancré à l'instant réel de la parole.
      expect(out[0]!.start).toBe(0);
      // Le second cue est repoussé (jamais avant, jamais tronqué/fusionné) —
      // aucun chevauchement avec la nouvelle fenêtre étirée du premier.
      expect(out[1]!.start).toBeGreaterThanOrEqual(out[0]!.end);
      expect(out[1]!.text).toBe('La suite de la phrase continue ici normalement');
    });

    it('propage le repoussement en cascade sur une chaîne de cues bout à bout', () => {
      // Chaque cue dure déjà 1s (>= MIN_CUE_SEC, donc AUCUNE fusion à l'étape 1)
      // mais son texte est trop dense pour 1s à MAX_CPS=17 (~25-30 caractères
      // → ~1,5-1,8s nécessaires), et posé bout à bout (aucun gap à voler).
      const out = realignCues([
        { start: 0, end: 1, text: 'Voici une toute première phrase' }, // 32 car.
        { start: 1, end: 2, text: 'Puis en voici une deuxième ici' }, // 31 car.
        { start: 2, end: 3, text: 'Et enfin une troisième phrase' }, // 30 car.
      ]);
      expect(out).toHaveLength(3);
      for (let i = 1; i < out.length; i += 1) {
        expect(out[i]!.start).toBeGreaterThanOrEqual(out[i - 1]!.end);
      }
      // cur.start du tout premier cue reste ancré (jamais avancé).
      expect(out[0]!.start).toBe(0);
      // Chaque cue atteint désormais une vitesse de lecture raisonnable
      // (≈17 cps visé ; légère tolérance pour l'arrondi flottant).
      for (const c of out) {
        expect(c.text.length / dur(c)).toBeLessThanOrEqual(17.5);
      }
    });

    it('ne modifie rien quand du silence est déjà disponible (comportement inchangé)', () => {
      const withGap = realignCues([
        { start: 0, end: 0.3, text: 'Bonjour tout le monde ici' },
        { start: 5, end: 7, text: 'Une phrase bien plus tard' },
      ]);
      // Le second cue garde son timing d'origine : rien à repousser, du
      // silence naturel existait déjà pour étirer le premier.
      expect(withGap[1]!.start).toBe(5);
      expect(withGap[1]!.end).toBe(7);
    });
  });
});
