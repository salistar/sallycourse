// Tests de la logique PURE de translate-published.ts (Prompt 92) : parsing/
// reconstruction SRT (timestamps préservés), sélection des langues cibles,
// validation de la structure de traduction. Aucun accès réseau/S3/Mongo ici.
import { describe, expect, it } from 'vitest';
import {
  applyTranslatedSegments,
  MAX_TARGET_LANGUAGES,
  parseSrt,
  parseSrtTimestamp,
  selectTargetLocales,
  translateSubtitlesSystemPrompt,
  translateSubtitlesUserPrompt,
  validateSubtitleTranslation,
  type TranslatableSegment,
  type TranslatedSegments,
} from './translate-published.js';
import { toSrt, type Cue } from '../media/subtitles.js';

describe('parseSrtTimestamp', () => {
  it('convertit un timestamp SRT en secondes', () => {
    expect(parseSrtTimestamp('00:00:00,000')).toBe(0);
    expect(parseSrtTimestamp('00:00:01,500')).toBeCloseTo(1.5);
    expect(parseSrtTimestamp('01:01:01,234')).toBeCloseTo(3661.234);
  });

  it('retourne 0 pour un timestamp malformé', () => {
    expect(parseSrtTimestamp('n/a')).toBe(0);
  });
});

describe('parseSrt', () => {
  it('reconstruit exactement les cues (timestamps + texte) d’un SRT bien formé', () => {
    const cues: Cue[] = [
      { start: 0, end: 2.5, text: 'Bonjour' },
      { start: 2.5, end: 5, text: 'et bienvenue' },
    ];
    const srt = toSrt(cues);
    const parsed = parseSrt(srt);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]!.text).toBe('Bonjour');
    expect(parsed[0]!.start).toBeCloseTo(0);
    expect(parsed[0]!.end).toBeCloseTo(2.5);
    expect(parsed[1]!.text).toBe('et bienvenue');
    expect(parsed[1]!.start).toBeCloseTo(2.5);
    expect(parsed[1]!.end).toBeCloseTo(5);
  });

  it('joint un texte multi-lignes en une seule ligne logique', () => {
    const srt = [
      '1',
      '00:00:00,000 --> 00:00:02,000',
      'Première ligne',
      'Deuxième ligne',
      '',
      '',
    ].join('\n');
    const parsed = parseSrt(srt);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.text).toBe('Première ligne Deuxième ligne');
  });

  it('ignore les blocs sans ligne de timing (tolérant, ne jette jamais)', () => {
    const srt = ['1', 'pas de timing ici', 'texte', '', '2', '00:00:01,000 --> 00:00:02,000', 'valide'].join('\n');
    const parsed = parseSrt(srt);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.text).toBe('valide');
  });

  it('retourne un tableau vide pour un contenu vide', () => {
    expect(parseSrt('')).toEqual([]);
  });
});

describe('roundtrip toSrt → parseSrt', () => {
  it('préserve les timestamps au milliseconde près sur un cas réaliste', () => {
    const cues: Cue[] = [
      { start: 0, end: 3.2, text: 'Introduction à la fiscalité.' },
      { start: 3.2, end: 7.75, text: 'Nous allons voir trois notions clés.' },
      { start: 7.75, end: 12, text: 'Première notion : le revenu imposable.' },
    ];
    const roundtripped = parseSrt(toSrt(cues));
    roundtripped.forEach((cue, i) => {
      expect(cue.start).toBeCloseTo(cues[i]!.start, 2);
      expect(cue.end).toBeCloseTo(cues[i]!.end, 2);
      expect(cue.text).toBe(cues[i]!.text);
    });
  });
});

describe('selectTargetLocales', () => {
  it('exclut la langue source et dédoublonne', () => {
    expect(selectTargetLocales(['fr', 'en', 'en', 'ar'], 'fr')).toEqual(['en', 'ar']);
  });

  it('ignore les langues inconnues', () => {
    expect(selectTargetLocales(['de', 'en', 'xx'], 'fr')).toEqual(['en']);
  });

  it('préserve l’ordre de la demande', () => {
    expect(selectTargetLocales(['ar', 'en'], 'fr')).toEqual(['ar', 'en']);
  });

  it('borne à MAX_TARGET_LANGUAGES', () => {
    // Seules 3 locales existent (fr/en/ar) : on vérifie juste que la borne ne casse rien.
    const many = Array.from({ length: MAX_TARGET_LANGUAGES + 5 }, () => 'en');
    expect(selectTargetLocales(many, 'fr')).toEqual(['en']);
  });

  it('retourne vide si aucune langue cible valide', () => {
    expect(selectTargetLocales(['fr'], 'fr')).toEqual([]);
    expect(selectTargetLocales([], 'fr')).toEqual([]);
  });
});

describe('validateSubtitleTranslation', () => {
  const source: TranslatableSegment[] = [
    { index: 0, text: 'Bonjour' },
    { index: 1, text: 'et bienvenue' },
  ];

  it('accepte une traduction de même structure', () => {
    const translated: TranslatedSegments = {
      segments: [
        { index: 0, text: 'Hello' },
        { index: 1, text: 'and welcome' },
      ],
    };
    expect(validateSubtitleTranslation(source, translated)).toEqual([]);
  });

  it('signale un nombre de segments divergent', () => {
    const translated: TranslatedSegments = { segments: [{ index: 0, text: 'Hello' }] };
    const problems = validateSubtitleTranslation(source, translated);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0]).toMatch(/divergent/);
  });

  it('signale un index inattendu', () => {
    const translated: TranslatedSegments = {
      segments: [
        { index: 0, text: 'Hello' },
        { index: 99, text: 'huh' },
      ],
    };
    const problems = validateSubtitleTranslation(source, translated);
    expect(problems.some((p) => p.includes('99'))).toBe(true);
  });
});

describe('applyTranslatedSegments', () => {
  it('réaligne le texte traduit sur les timestamps source, par index', () => {
    const sourceCues: Cue[] = [
      { start: 0, end: 2, text: 'Bonjour' },
      { start: 2, end: 4, text: 'et bienvenue' },
    ];
    const translated: TranslatedSegments = {
      segments: [
        { index: 0, text: 'Hello' },
        { index: 1, text: 'and welcome' },
      ],
    };
    const result = applyTranslatedSegments(sourceCues, translated);
    expect(result).toEqual([
      { start: 0, end: 2, text: 'Hello' },
      { start: 2, end: 4, text: 'and welcome' },
    ]);
  });

  it('retombe sur le texte source si un segment traduit est manquant', () => {
    const sourceCues: Cue[] = [{ start: 0, end: 2, text: 'Bonjour' }];
    const translated: TranslatedSegments = { segments: [] };
    const result = applyTranslatedSegments(sourceCues, translated);
    expect(result[0]!.text).toBe('Bonjour');
  });
});

describe('prompts de traduction', () => {
  it('le prompt système mentionne la langue cible et les règles de structure', () => {
    const prompt = translateSubtitlesSystemPrompt('en');
    expect(prompt).toMatch(/anglais/);
    expect(prompt).toMatch(/index/);
  });

  it('le prompt utilisateur sérialise les segments en JSON', () => {
    const segments: TranslatableSegment[] = [{ index: 0, text: 'Bonjour' }];
    const prompt = translateSubtitlesUserPrompt(segments);
    expect(prompt).toContain('"index": 0');
    expect(prompt).toContain('Bonjour');
  });
});
