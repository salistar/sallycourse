// Config de requête next-intl — résout la locale d'UI depuis le cookie
// NEXT_LOCALE et charge le bundle de messages correspondant. Consommée par
// le plugin createNextIntlPlugin (voir next.config.mjs).
import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { LOCALE_COOKIE, defaultLocale, normalizeLocale } from './routing';

export default getRequestConfig(async () => {
  // La préférence est stockée côté client via le sélecteur de langue.
  const store = await cookies();
  const locale = normalizeLocale(store.get(LOCALE_COOKIE)?.value ?? defaultLocale);

  // Import dynamique du bundle : seul le JSON de la locale active est chargé.
  const messages = (await import(`../../messages/${locale}.json`)).default;

  return { locale, messages };
});
