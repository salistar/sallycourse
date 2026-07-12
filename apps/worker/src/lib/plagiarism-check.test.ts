// Tests de la détection de plagiat sortant (P141) — uniquement la logique
// PURE : extraction de phrases distinctives et seuil/score d'originalité.
// Pas de test réseau (searchPhraseOnWeb/checkTextOriginality nécessitent
// getConfig() + fetch — hors scope « logique pure » de ce prompt).
import { describe, expect, it } from 'vitest';
import {
  computeOriginalityScore,
  extractDistinctivePhrases,
  PLAGIARISM,
  samplePhrasesForCheck,
  shouldSuggestRegeneration,
  toComplianceNote,
  type PhraseMatchResult,
} from './plagiarism-check.js';

describe('extractDistinctivePhrases', () => {
  it('retourne [] pour un texte plus court que la fenêtre', () => {
    expect(extractDistinctivePhrases('quelques mots seulement ici')).toEqual([]);
  });

  it('extrait des fenêtres non chevauchantes de PHRASE_WORD_COUNT mots', () => {
    const words = Array.from({ length: 24 }, (_, i) => `mot${i}`);
    const text = words.join(' ');
    const phrases = extractDistinctivePhrases(text, 8);
    expect(phrases).toHaveLength(3);
    expect(phrases[0]!.text).toBe(words.slice(0, 8).join(' '));
    expect(phrases[1]!.text).toBe(words.slice(8, 16).join(' '));
    expect(phrases[1]!.index).toBe(8);
    expect(phrases[2]!.text).toBe(words.slice(16, 24).join(' '));
  });

  it('ignore les blocs de code fencés (bruit, pas du contenu pédagogique comparable)', () => {
    const text = '```js\nconst a = 1; const b = 2; const c = 3; const d = 4;\n```';
    expect(extractDistinctivePhrases(text)).toEqual([]);
  });

  it('est déterministe (même entrée -> même sortie)', () => {
    const text = Array.from({ length: 16 }, (_, i) => `terme${i}`).join(' ');
    expect(extractDistinctivePhrases(text)).toEqual(extractDistinctivePhrases(text));
  });
});

describe('samplePhrasesForCheck', () => {
  it('retourne toutes les phrases si en dessous du plafond', () => {
    const phrases = extractDistinctivePhrases(
      Array.from({ length: 16 }, (_, i) => `mot${i}`).join(' '),
    );
    expect(samplePhrasesForCheck(phrases, 5)).toEqual(phrases);
  });

  it('borne à maxCount en répartissant sur tout le texte (pas seulement le début)', () => {
    const phrases = extractDistinctivePhrases(
      Array.from({ length: 80 }, (_, i) => `mot${i}`).join(' '),
      8,
    );
    expect(phrases.length).toBeGreaterThan(5);
    const sampled = samplePhrasesForCheck(phrases, 5);
    expect(sampled).toHaveLength(5);
    // Pas uniquement les 5 premières -> couverture répartie.
    expect(sampled[sampled.length - 1]!.index).toBeGreaterThan(phrases[4]!.index);
  });
});

describe('computeOriginalityScore', () => {
  it('retourne le score par défaut mock quand aucune phrase vérifiée', () => {
    expect(computeOriginalityScore([])).toBe(PLAGIARISM.MOCK_DEFAULT_SCORE);
  });

  it('retourne 1 quand aucune correspondance trouvée', () => {
    const results: PhraseMatchResult[] = [
      { phrase: 'a', matched: false },
      { phrase: 'b', matched: false },
    ];
    expect(computeOriginalityScore(results)).toBe(1);
  });

  it('applique une pénalité par phrase trouvée en correspondance', () => {
    const results: PhraseMatchResult[] = [
      { phrase: 'a', matched: true },
      { phrase: 'b', matched: false },
    ];
    expect(computeOriginalityScore(results)).toBeCloseTo(1 - PLAGIARISM.SCORE_PENALTY_PER_MATCH, 5);
  });

  it('plancher à 0, jamais négatif même avec beaucoup de correspondances', () => {
    const results: PhraseMatchResult[] = Array.from({ length: 20 }, () => ({
      phrase: 'x',
      matched: true,
    }));
    expect(computeOriginalityScore(results)).toBe(0);
  });
});

describe('shouldSuggestRegeneration', () => {
  it('true en dessous du seuil', () => {
    expect(shouldSuggestRegeneration(PLAGIARISM.REGENERATE_THRESHOLD - 0.01)).toBe(true);
  });

  it('false au-dessus ou égal au seuil', () => {
    expect(shouldSuggestRegeneration(PLAGIARISM.REGENERATE_THRESHOLD)).toBe(false);
    expect(shouldSuggestRegeneration(1)).toBe(false);
  });
});

describe('toComplianceNote', () => {
  it('retourne null si aucune régénération suggérée', () => {
    const note = toComplianceNote(
      {
        method: 'mock-skip',
        score: 0.95,
        phrasesChecked: [],
        suggestRegeneration: false,
        disclaimer: 'x',
      },
      'Introduction',
    );
    expect(note).toBeNull();
  });

  it('retourne une remarque MAX_ORIGINALITY_LOW (warning) si régénération suggérée', () => {
    const note = toComplianceNote(
      {
        method: 'web-search',
        score: 0.5,
        phrasesChecked: [{ phrase: 'x', matched: true, sourceUrl: 'https://exemple.test' }],
        suggestRegeneration: true,
        disclaimer: 'Vérification best-effort.',
      },
      'Les bases de Python',
    );
    expect(note).not.toBeNull();
    expect(note!.code).toBe('MAX_ORIGINALITY_LOW');
    expect(note!.severity).toBe('warning');
    expect(note!.message).toContain('Les bases de Python');
    expect(note!.message).toContain('50%');
  });
});
