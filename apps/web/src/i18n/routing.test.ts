import { describe, expect, it } from 'vitest';
import { defaultLocale, isRtlLocale, locales, localeDirection, normalizeLocale } from './routing';

describe('i18n/routing', () => {
  it('expose fr/en/ar avec fr par défaut', () => {
    expect(locales).toEqual(['fr', 'en', 'ar']);
    expect(defaultLocale).toBe('fr');
  });

  it('détecte l’arabe comme RTL, le reste LTR', () => {
    expect(isRtlLocale('ar')).toBe(true);
    expect(isRtlLocale('fr')).toBe(false);
    expect(isRtlLocale('en')).toBe(false);
    expect(localeDirection('ar')).toBe('rtl');
    expect(localeDirection('fr')).toBe('ltr');
  });

  it('normalise une valeur inconnue vers la locale par défaut', () => {
    expect(normalizeLocale('en')).toBe('en');
    expect(normalizeLocale('ar')).toBe('ar');
    expect(normalizeLocale('de')).toBe('fr');
    expect(normalizeLocale(undefined)).toBe('fr');
    expect(normalizeLocale(null)).toBe('fr');
    expect(normalizeLocale('')).toBe('fr');
  });
});
