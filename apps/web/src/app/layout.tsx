import type { Metadata } from 'next';
import { Figtree, Fraunces, IBM_Plex_Sans_Arabic } from 'next/font/google';
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
  title: 'SallyCourse',
  description: 'Génération automatique de cours — titre + niveau → cours complet.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="fr"
      className={`dark ${fraunces.variable} ${figtree.variable} ${ibmPlexSansArabic.variable}`}
      suppressHydrationWarning
    >
      <body>{children}</body>
    </html>
  );
}
