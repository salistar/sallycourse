import type { Metadata } from 'next';
import { Figtree, Fraunces, IBM_Plex_Sans_Arabic } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { MotionProvider } from '@/components/motion';
import { UmamiScript } from '@/components/umami';
import { localeDirection } from '@/i18n/routing';
import './globals.css';

// Polices du design system SALISTAR — exposées en CSS variables
// consommées par le preset Tailwind (@sallycourse/design/tailwind).

/** Serif expressive pour les titres (font-display). */
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

/** Sans humaniste pour le corps latin (font-sans). */
const figtree = Figtree({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

/** Famille arabe — titres et corps en contexte RTL (font-arabic). */
const ibmPlexSansArabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-arabic',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? 'http://localhost:3000'),
  title: {
    default: 'SallyCourse — Créez un cours en ligne en quelques minutes',
    template: '%s · SallyCourse',
  },
  description: 'Génération automatique de cours — titre + niveau → cours complet.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Locale résolue par next-intl (cookie NEXT_LOCALE → défaut fr) et messages
  // du bundle actif ; `dir` bascule en RTL pour l'arabe (localeDirection).
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      dir={localeDirection(locale)}
      className={`dark ${fraunces.variable} ${figtree.variable} ${ibmPlexSansArabic.variable}`}
      suppressHydrationWarning
    >
      <body>
        {/* Tracking d'audience OSS (P157) — no-op sans NEXT_PUBLIC_UMAMI_*, pas de cookie tiers. */}
        <UmamiScript />
        {/* Provider next-intl : expose messages + locale aux composants client. */}
        <NextIntlClientProvider locale={locale} messages={messages}>
          {/* Provider global du motion : transition par défaut + prefers-reduced-motion. */}
          <MotionProvider>{children}</MotionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
