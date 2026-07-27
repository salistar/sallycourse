import { describe, expect, it } from 'vitest';
import { VOICE_CATALOG, VOICE_CATALOG_IDS, getCatalogVoice, resolveCatalogVoice } from './voice-catalog';

describe('voice-catalog — catalogue de voix épinglées (fix « voix multiples »)', () => {
  it('expose au moins 8 voix aux ids uniques et stables', () => {
    expect(VOICE_CATALOG.length).toBeGreaterThanOrEqual(8);
    expect(new Set(VOICE_CATALOG_IDS).size).toBe(VOICE_CATALOG_IDS.length);
  });

  it('chaque voix a une voix Edge source et un texte d\'échantillon', () => {
    for (const v of VOICE_CATALOG) {
      expect(v.edgeVoice).toMatch(/Neural$/);
      expect(v.sampleText.length).toBeGreaterThan(80);
      expect(v.locales.length).toBeGreaterThan(0);
    }
  });

  it('les défauts par langue restent les identités Edge historiques (aucun changement pour les cours existants)', () => {
    // fr → Denise, en → Aria, ar → Zariyah : mêmes défauts que EDGE_TTS_DEFAULT_VOICES.
    expect(resolveCatalogVoice(undefined, 'fr').edgeVoice).toBe('fr-FR-DeniseNeural');
    expect(resolveCatalogVoice(undefined, 'en').edgeVoice).toBe('en-US-AriaNeural');
    expect(resolveCatalogVoice(undefined, 'ar').edgeVoice).toBe('ar-SA-ZariyahNeural');
  });

  it('un voiceId valide prime sur le défaut de la langue', () => {
    expect(resolveCatalogVoice('henri', 'en').id).toBe('henri');
  });

  it('un voiceId inconnu (données legacy) retombe sur le défaut de la langue', () => {
    expect(resolveCatalogVoice('voix-disparue', 'fr').id).toBe('claire');
    expect(getCatalogVoice('voix-disparue')).toBeUndefined();
  });

  it('langue inconnue → défaut français (jamais d\'exception)', () => {
    expect(resolveCatalogVoice(undefined, 'de').id).toBe('claire');
  });
});
