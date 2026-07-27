import { describe, expect, it } from 'vitest';
import { parseDialogueTurns } from './tts-generation.js';

describe('parseDialogueTurns (P169)', () => {
  it('découpe une narration balisée en tours de parole, sans les balises', () => {
    const turns = parseDialogueTurns(
      '[Formateur] Voici les tests unitaires. [Apprenant] Pourquoi sont-ils importants ? [Formateur] Ils détectent les régressions.',
    );
    expect(turns).not.toBeNull();
    expect(turns).toHaveLength(3);
    expect(turns![0]).toEqual({ role: 'instructor', text: 'Voici les tests unitaires.' });
    expect(turns![1]).toEqual({ role: 'learner', text: 'Pourquoi sont-ils importants ?' });
    // les balises ne figurent JAMAIS dans le texte narré
    expect(turns!.every((t) => !t.text.includes('['))).toBe(true);
  });

  it('retourne null si moins de 2 tours (pas un vrai dialogue)', () => {
    expect(parseDialogueTurns('[Formateur] Un seul tour.')).toBeNull();
    expect(parseDialogueTurns('Aucune balise ici.')).toBeNull();
    expect(parseDialogueTurns('')).toBeNull();
  });
});
