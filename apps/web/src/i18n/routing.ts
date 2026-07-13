// Configuration i18n centrale — locales supportées et locale par défaut.
// Approche SANS routing préfixé : la locale de l'UI est portée par le cookie
// NEXT_LOCALE (lu dans request.ts). Les pages ne vivent pas sous /[locale].
// Le CONTENU des cours suit Course.locale, indépendant de cette locale d'UI.
// Sous-module direct (et non le barrel @sallycourse/shared) : le barrel
// réexporte crypto.ts (node:crypto), incompatible avec le bundle client
// (ce fichier est importé depuis des composants client via components/i18n).
import { LOCALES, RTL_LOCALES, type Locale } from '@sallycourse/shared/constants';

/** Locales de l'interface (réexport depuis @sallycourse/shared, source unique). */
export const locales = LOCALES;

/** Locale par défaut lorsque le cookie est absent ou invalide. */
export const defaultLocale: Locale = 'fr';

/** Nom du cookie porteur de la préférence de langue (convention next-intl). */
export const LOCALE_COOKIE = 'NEXT_LOCALE';

/** Vrai si la locale s'écrit de droite à gauche (réutilise RTL_LOCALES de shared). */
export function isRtlLocale(locale: string): boolean {
  return (RTL_LOCALES as readonly string[]).includes(locale);
}

/** Direction du document pour une locale donnée. */
export function localeDirection(locale: string): 'rtl' | 'ltr' {
  return isRtlLocale(locale) ? 'rtl' : 'ltr';
}

/** Garde de type : normalise une valeur inconnue vers une locale supportée. */
export function normalizeLocale(value: string | undefined | null): Locale {
  return (locales as readonly string[]).includes(value ?? '') ? (value as Locale) : defaultLocale;
}

export type { Locale };
