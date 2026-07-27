import { describe, expect, it } from 'vitest';
import { flashcardsToAnkiTsv } from './flashcards.js';

/** Lignes de cartes (l'en-tête `#…` d'Anki est ignoré). */
function cardLines(tsv: string): string[] {
  return tsv.split('\n').filter((l) => !l.startsWith('#'));
}

describe('flashcardsToAnkiTsv (P203)', () => {
  it('produit un TSV « recto<TAB>verso », une carte par ligne', () => {
    const tsv = flashcardsToAnkiTsv([
      { front: 'Qu’est-ce que le TDD ?', back: 'Test-Driven Development : écrire le test avant le code.' },
      { front: 'Rôle du mock ?', back: 'Simuler une dépendance.' },
    ]);
    const lines = cardLines(tsv);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.split('\t')).toHaveLength(2);
    expect(lines[0]).toBe('Qu’est-ce que le TDD ?\tTest-Driven Development : écrire le test avant le code.');
  });

  it('déclare le séparateur en en-tête (pas de devinette de délimiteur côté Anki)', () => {
    const tsv = flashcardsToAnkiTsv([{ front: 'A', back: 'B' }]);
    expect(tsv.split('\n')[0]).toBe('#separator:tab');
  });

  it('nettoie tabs et retours à la ligne internes (ne casse pas le format Anki)', () => {
    const tsv = flashcardsToAnkiTsv([{ front: 'A\tB', back: 'ligne1\nligne2' }]);
    expect(cardLines(tsv)[0]).toBe('A B\tligne1 ligne2');
    expect(cardLines(tsv)[0]!.split('\t')).toHaveLength(2);
  });

  it('échappe les guillemets (Anki parse en RFC-4180 : un champ qui commence par " avalait la suite)', () => {
    const tsv = flashcardsToAnkiTsv([
      { front: '"Clean code" : que signifie ce terme ?', back: 'Un code lisible et simple à modifier.' },
      { front: 'Question suivante', back: 'Réponse suivante' },
    ]);
    const lines = cardLines(tsv);
    // Champ cité + guillemets doublés → la carte reste intacte…
    expect(lines[0]).toBe('"""Clean code"" : que signifie ce terme ?"\tUn code lisible et simple à modifier.');
    // …et la carte suivante n'est PAS avalée.
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('Question suivante\tRéponse suivante');
  });

  it('cite une carte commençant par « # » (sinon Anki la lit comme un commentaire)', () => {
    const tsv = flashcardsToAnkiTsv([{ front: '#hashtag : à quoi sert-il ?', back: 'À marquer un sujet.' }]);
    expect(cardLines(tsv)[0]).toBe('"#hashtag : à quoi sert-il ?"\tÀ marquer un sujet.');
  });
});
