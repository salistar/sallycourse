// Tests des helpers purs de la synthèse vocale : choix de voix par langue,
// déterminisme de la clé de cache (sha256 texte+voix+langue) et estimation de
// durée du silence de secours. Les chemins réseau/ffmpeg/S3 ne sont pas couverts
// ici (dépendances externes) mais les invariants déterministes le sont.
import { describe, expect, it } from 'vitest';
import { AUDIO } from '../shared.js';
import { clampNarrationSpeed, estimateNarrationSeconds, resolveVoice, ttsCacheKey } from './tts.js';

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

  it('P137 — la vitesse par défaut (1 ou absente) ne change pas la clé historique', () => {
    expect(ttsCacheKey('Salut', 'v', 'fr')).toBe(ttsCacheKey('Salut', 'v', 'fr', 1));
  });

  it('P137 — une vitesse différente produit une clé de cache différente', () => {
    expect(ttsCacheKey('Salut', 'v', 'fr', 1.15)).not.toBe(ttsCacheKey('Salut', 'v', 'fr', 1));
    expect(ttsCacheKey('Salut', 'v', 'fr', 0.85)).not.toBe(ttsCacheKey('Salut', 'v', 'fr', 1.15));
  });
});

describe('clampNarrationSpeed (P137)', () => {
  it('retombe sur 1 si absente ou non finie', () => {
    expect(clampNarrationSpeed(undefined)).toBe(1);
    expect(clampNarrationSpeed(Number.NaN)).toBe(1);
  });

  it('borne à [0.75, 1.25]', () => {
    expect(clampNarrationSpeed(0.5)).toBe(0.75);
    expect(clampNarrationSpeed(2)).toBe(1.25);
    expect(clampNarrationSpeed(1.1)).toBe(1.1);
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

  it('P137 — une vitesse > 1 raccourcit la durée estimée, < 1 l’allonge', () => {
    const words = 280;
    const text = Array.from({ length: words }, () => 'mot').join(' ');
    const base = estimateNarrationSeconds(text);
    expect(estimateNarrationSeconds(text, 1.25)).toBeCloseTo(base / 1.25, 5);
    expect(estimateNarrationSeconds(text, 0.75)).toBeCloseTo(base / 0.75, 5);
  });
});
