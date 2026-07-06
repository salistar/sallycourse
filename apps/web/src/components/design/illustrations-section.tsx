'use client';

import * as React from 'react';
import { PreviewFrame } from './preview-frame';
import { ExampleLabel, StyleSection } from './section-shell';
import {
  IllustrationConstellation,
  IllustrationEtincelle,
  IllustrationFluxCours,
  IllustrationStrates,
} from './illustrations';

/**
 * Section illustrations : le langage graphique « flux » — géométrie
 * abstraite, traits fins violet, ponctuation dorée. Chaque illustration
 * est un composant réutilisable (src/components/design/illustrations.tsx).
 */

function IllustrationCard({
  name,
  usage,
  children,
}: {
  name: string;
  usage: string;
  children: React.ReactNode;
}) {
  // Liseré dégradé 1px autour de la vignette — cohérent avec Card (D3)
  return (
    <figure className="flex flex-col gap-3">
      <div className="rounded-lg bg-gradient-to-br from-primary-500/40 via-border to-accent-400/40 p-px">
        <div className="rounded-[calc(1rem-1px)] bg-surface p-4">
          {children}
        </div>
      </div>
      <figcaption className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-foreground">{name}</span>
        <span className="text-xs text-muted">{usage}</span>
      </figcaption>
    </figure>
  );
}

export function IllustrationsSection() {
  return (
    <StyleSection
      id="illustrations"
      index={5}
      title="Illustrations"
      lead="Un langage de « flux » : l'étincelle du prompt traverse des courants violets et se matérialise en savoir structuré. Géométrie abstraite, traits de 1,5 px, or en ponctuation seulement — jamais d'aplat massif."
    >
      <PreviewFrame>
        <div className="flex flex-col gap-8">
          <div className="grid gap-6 lg:grid-cols-2">
            <IllustrationCard
              name="Flux prompt → cours"
              usage="Illustration héroïque — accueil, écrans de génération. <IllustrationFluxCours />"
            >
              <IllustrationFluxCours title="Une étincelle se déploie en trois courants qui deviennent des modules de cours" className="h-auto w-full" />
            </IllustrationCard>
            <div className="grid gap-6 sm:grid-cols-2">
              <IllustrationCard
                name="Constellation"
                usage="Bibliothèque, états vides riches. <IllustrationConstellation />"
              >
                <IllustrationConstellation title="Graphe de notions reliées autour d'un nœud doré" className="h-auto w-full" />
              </IllustrationCard>
              <IllustrationCard
                name="Strates de savoir"
                usage="Progression, paliers. <IllustrationStrates />"
              >
                <IllustrationStrates title="Couches isométriques traversées par un fil doré ascendant" className="h-auto w-full" />
              </IllustrationCard>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <ExampleLabel>Étincelle — motif de ponctuation</ExampleLabel>
            <div className="flex flex-wrap items-center gap-6 rounded-md border border-border/60 bg-surface p-5">
              <IllustrationEtincelle className="h-12 w-12" title="Étincelle SALISTAR" />
              <IllustrationEtincelle className="h-8 w-8" />
              <IllustrationEtincelle className="h-5 w-5" />
              <p className="max-w-md text-xs text-muted">
                Quatre branches concaves, or sur cercle violet. À utiliser en jalon de liste,
                marqueur de célébration ou signature discrète — une seule par écran suffit.
              </p>
            </div>
          </div>

          <ul className="grid gap-2 text-xs text-muted sm:grid-cols-3">
            <li className="rounded-md border border-border/60 bg-surface-subtle/60 p-3">
              <strong className="font-semibold text-foreground">Traits</strong> — 1,5 px, terminaisons rondes,
              violet 400/500 en opacité 30–70&nbsp;%.
            </li>
            <li className="rounded-md border border-border/60 bg-surface-subtle/60 p-3">
              <strong className="font-semibold text-foreground">Dégradé</strong> — violet → or réservé aux
              trajectoires et liserés, jamais en remplissage.
            </li>
            <li className="rounded-md border border-border/60 bg-surface-subtle/60 p-3">
              <strong className="font-semibold text-foreground">Or</strong> — un seul point focal doré par
              illustration&nbsp;: l&apos;idée, le cours, l&apos;accomplissement.
            </li>
          </ul>
        </div>
      </PreviewFrame>
    </StyleSection>
  );
}
