'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('design.illustrations');
  return (
    <StyleSection
      id="illustrations"
      index={5}
      title={t('sectionTitle')}
      lead={t('lead')}
    >
      <PreviewFrame>
        <div className="flex flex-col gap-8">
          <div className="grid gap-6 lg:grid-cols-2">
            <IllustrationCard
              name={t('cards.fluxCours.name')}
              usage={t('cards.fluxCours.usage')}
            >
              <IllustrationFluxCours title={t('cards.fluxCours.title')} className="h-auto w-full" />
            </IllustrationCard>
            <div className="grid gap-6 sm:grid-cols-2">
              <IllustrationCard
                name={t('cards.constellation.name')}
                usage={t('cards.constellation.usage')}
              >
                <IllustrationConstellation title={t('cards.constellation.title')} className="h-auto w-full" />
              </IllustrationCard>
              <IllustrationCard
                name={t('cards.strates.name')}
                usage={t('cards.strates.usage')}
              >
                <IllustrationStrates title={t('cards.strates.title')} className="h-auto w-full" />
              </IllustrationCard>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <ExampleLabel>{t('etincelle.label')}</ExampleLabel>
            <div className="flex flex-wrap items-center gap-6 rounded-md border border-border/60 bg-surface p-5">
              <IllustrationEtincelle className="h-12 w-12" title={t('etincelle.title')} />
              <IllustrationEtincelle className="h-8 w-8" />
              <IllustrationEtincelle className="h-5 w-5" />
              <p className="max-w-md text-xs text-muted">
                {t('etincelle.description')}
              </p>
            </div>
          </div>

          <ul className="grid gap-2 text-xs text-muted sm:grid-cols-3">
            <li className="rounded-md border border-border/60 bg-surface-subtle/60 p-3">
              <strong className="font-semibold text-foreground">{t('rules.strokes.term')}</strong> {t('rules.strokes.desc')}
            </li>
            <li className="rounded-md border border-border/60 bg-surface-subtle/60 p-3">
              <strong className="font-semibold text-foreground">{t('rules.gradient.term')}</strong> {t('rules.gradient.desc')}
            </li>
            <li className="rounded-md border border-border/60 bg-surface-subtle/60 p-3">
              <strong className="font-semibold text-foreground">{t('rules.gold.term')}</strong> {t('rules.gold.desc')}
            </li>
          </ul>
        </div>
      </PreviewFrame>
    </StyleSection>
  );
}
