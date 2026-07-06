// Tests des helpers purs de la synthèse vocale : choix de voix par langue,
// déterminisme de la clé de cache (sha256 texte+voix+langue) et estimation de
// durée du silence de secours. Les chemins réseau/ffmpeg/S3 ne sont pas couverts
// ici (dépendances externes) mais les invariants déterministes le sont.
import { describe, expect, it } from 'vitest';
import { AUDIO } from '../shared.js';
import { estimateNarrationSeconds, resolveVoice, ttsCacheKey } from './tts.js';

describe('resolveVoice', () => {
  it('privilégie la voix forcée (Course.ttsVoice) quand elle est fournie', () => {
    expect(resolveVoice('fr', 'MaVoixCustom')).toBe('MaVoixCustom');
    expect(resolveVoice('en', '  VoixEspacée  ')).toBe('VoixEspacée');
  });

  it('retombe sur une voix par défaut selon la langue', () => {
    expect(resolveVoice('fr')).toBeTruthy();
    expect(resolveVoice('en')).toBeTruthy();
    expect(resolveVoice('ar')).toBeTruthy();
  });

  it('retombe sur la voix multilingue pour une langue inconnue', () => {
    expect(resolveVoice('xx')).toBe(resolveVoice('fr'));
  });
});

describe('ttsCacheKey', () => {
  it('est déterministe pour un même triplet texte/voix/langue', () => {
    const a = ttsCacheKey('Bonjour le monde', 'voice1', 'fr');
    const b = ttsCacheKey('Bonjour le monde', 'voice1', 'fr');
    expect(a).toBe(b);
    expect(a).toMatch(/^tts-cache\/[0-9a-f]{64}\.mp3$/);
  });

  it('ignore les espaces de bord du texte (trim) mais distingue voix et langue', () => {
    expect(ttsCacheKey('  Salut  ', 'v', 'fr')).toBe(ttsCacheKey('Salut', 'v', 'fr'));
    expect(ttsCacheKey('Salut', 'v1', 'fr')).not.toBe(ttsCacheKey('Salut', 'v2', 'fr'));
    expect(ttsCacheKey('Salut', 'v', 'fr')).not.toBe(ttsCacheKey('Salut', 'v', 'en'));
  });
});

describe('estimateNarrationSeconds', () => {
  it('respecte un plancher pour les textes très courts', () => {
    expect(estimateNarrationSeconds('Salut')).toBeGreaterThanOrEqual(1.5);
  });

  it('croît avec le nombre de mots au débit AUDIO.NARRATION_WORDS_PER_MINUTE', () => {
    const words = 280; // 2 min à 140 mots/min
    const text = Array.from({ length: words }, () => 'mot').join(' ');
    const expected = (words / AUDIO.NARRATION_WORDS_PER_MINUTE) * 60;
    expect(estimateNarrationSeconds(text)).toBeCloseTo(expected, 5);
  });
});
