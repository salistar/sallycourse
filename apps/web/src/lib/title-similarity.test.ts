// Tests du miroir léger de similarité de titres (P115).
import { describe, expect, it } from 'vitest';
import { compareTitleSimilarity, findMostSimilarTitle } from './title-similarity';

describe('compareTitleSimilarity', () => {
  it('retourne 1 pour deux titres identiques', () => {
    expect(compareTitleSimilarity('Apprendre React', 'Apprendre React')).toBe(1);
  });

  it('retourne 0 pour deux titres sans rapport', () => {
    expect(compareTitleSimilarity('Apprendre React de zéro', 'Recette de cuisine marocaine facile')).toBe(0);
  });
});

describe('findMostSimilarTitle', () => {
  it('ne signale rien sans titre proche', () => {
    expect(findMostSimilarTitle('Apprendre React', ['Cuisine marocaine', 'Photographie de nuit'])).toBeUndefined();
  });

  it('signale le titre quasi-identique existant', () => {
    const match = findMostSimilarTitle('Apprendre React de zéro à héros', [
      'Cuisine marocaine',
      'Apprendre React de zéro à héros',
    ]);
    expect(match).toBeDefined();
    expect(match?.title).toBe('Apprendre React de zéro à héros');
    expect(match?.score).toBe(1);
  });
});
