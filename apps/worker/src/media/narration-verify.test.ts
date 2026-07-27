import { describe, expect, it } from 'vitest';
import { normalizeForCompare, transcriptSimilarity } from './narration-verify.js';

describe('normalizeForCompare', () => {
  it('met en minuscules, retire accents et ponctuation, compacte les espaces', () => {
    expect(normalizeForCompare('Bonjour,   le Monde !')).toBe('bonjour le monde');
    expect(normalizeForCompare('Éléphant à café')).toBe('elephant a cafe');
  });
});

describe('transcriptSimilarity', () => {
  it('vaut 1 pour une transcription identique', () => {
    expect(transcriptSimilarity('le chat mange la souris', 'le chat mange la souris')).toBe(1);
  });

  it('vaut 0 quand aucun mot ne correspond (parole dégénérée)', () => {
    expect(transcriptSimilarity('le chat mange la souris', 'xyz abc def ghi jkl')).toBe(0);
  });

  it('reste haute pour une transcription fidèle à quelques fautes près', () => {
    const s = transcriptSimilarity(
      'la due diligence environnementale est une étape essentielle',
      'la due diligence environnementale est une étape essentiel',
    );
    expect(s).toBeGreaterThan(0.8);
  });

  it('gère les textes à un seul mot (égalité exacte)', () => {
    expect(transcriptSimilarity('bonjour', 'bonjour')).toBe(1);
    expect(transcriptSimilarity('bonjour', 'salut')).toBe(0);
  });

  it('retourne 0 si l’un des deux textes est vide', () => {
    expect(transcriptSimilarity('', 'quelque chose')).toBe(0);
    expect(transcriptSimilarity('quelque chose', '')).toBe(0);
  });
});
