'use client';

import * as React from 'react';
import { DesignSettingsProvider, useDesignSettings } from './design-context';
import { DesignToolbar } from './design-toolbar';
import { GrainOverlay } from './grain';
import { IllustrationFluxCours } from './illustrations';
import { PaletteSection } from './palette-section';
import { TypographySection } from './typography-section';
import { FoundationsSection } from './foundations-section';
import { MotionSection } from './motion-section';
import { IllustrationsSection } from './illustrations-section';

/**
 * Styleguide vivant SALISTAR — la direction artistique de SallyCourse
 * matérialisée : ambiance « studio de production haut de gamme », fonds
 * sombres teintés violet, verre dépoli discret, dégradés violet → or en
 * fins liserés et halos uniquement, grain photographique léger.
 */

const TOC = [
  { href: '#palette', label: 'Palette' },
  { href: '#typographie', label: 'Typographie' },
  { href: '#fondations', label: 'Fondations' },
  { href: '#motion', label: 'Motion' },
  { href: '#illustrations', label: 'Illustrations' },
];

/** En-tête héroïque : halos violets/or, grain, sommaire en pills de verre. */
function Hero() {
  const { grain } = useDesignSettings();

  return (
    <header className="relative overflow-hidden border-b border-border/60">
      {/* Halos — la lumière du plateau, jamais d'aplat de dégradé */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 start-1/4 h-96 w-96 rounded-full bg-primary-600/20 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-16 end-[12%] h-72 w-72 rounded-full bg-accent-500/10 blur-3xl"
      />
      {grain ? <GrainOverlay intensity={0.25} /> : null}

      <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-10 px-6 pb-16 pt-20 lg:grid-cols-[1.2fr_1fr] lg:pb-20 lg:pt-24">
        <div className="flex flex-col items-start gap-6">
          {/* Kicker sur liseré dégradé — signature de la marque */}
          <div className="rounded-full bg-gradient-to-r from-primary-500/60 via-border to-accent-400/60 p-px">
            <p className="rounded-full bg-surface/80 px-4 py-1.5 text-2xs font-semibold uppercase tracking-widest text-accent backdrop-blur-md">
              SALISTAR · Direction artistique
            </p>
          </div>

          <h1 className="font-display text-4xl font-semibold text-foreground sm:text-5xl">
            Le studio où chaque
            <br />
            idée devient un cours.
          </h1>

          <p className="max-w-xl text-lg text-muted">
            Fonds sombres profonds teintés de violet, or en touches rares, verre dépoli et
            grain de pellicule&nbsp;: SallyCourse emprunte ses codes aux studios de production
            haut de gamme. Ce guide vivant en est la référence — observez chaque fondation
            en light, dark et RTL.
          </p>

          <nav aria-label="Sommaire du styleguide" className="flex flex-wrap gap-2">
            {TOC.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-full border border-border/70 bg-surface/60 px-4 py-1.5 text-sm font-medium text-muted backdrop-blur-md transition-colors duration-fast hover:border-primary-400/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80"
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>

        <IllustrationFluxCours
          title="Illustration du flux : d'une étincelle de prompt naissent les modules d'un cours"
          className="h-auto w-full max-w-md justify-self-center animate-fade-in-up lg:justify-self-end"
        />
      </div>
    </header>
  );
}

/** Pied de page : rappel de la source de vérité des tokens. */
function Footer() {
  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-6 py-10 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
        <p>
          Source de vérité&nbsp;:{' '}
          <span className="font-semibold text-foreground">packages/design/src/tokens.ts</span> —
          aucune couleur hex ailleurs.
        </p>
        <p>
          Composants&nbsp;:{' '}
          <a
            href="/design/components"
            className="font-semibold text-foreground underline decoration-accent-400/60 underline-offset-4 transition-colors duration-fast hover:decoration-accent-400"
          >
            /design/components
          </a>
        </p>
      </div>
    </footer>
  );
}

export function DesignStyleguide() {
  return (
    <DesignSettingsProvider>
      <div className="min-h-screen bg-background text-foreground transition-colors duration-base">
        <Hero />
        <DesignToolbar />
        <main className="mx-auto flex max-w-6xl flex-col gap-20 px-6 pb-28 pt-14 sm:gap-24">
          <PaletteSection />
          <TypographySection />
          <FoundationsSection />
          <MotionSection />
          <IllustrationsSection />
        </main>
        <Footer />
      </div>
    </DesignSettingsProvider>
  );
}
