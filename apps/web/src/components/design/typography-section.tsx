'use client';

import * as React from 'react';
import { PreviewFrame } from './preview-frame';
import { ExampleLabel, StyleSection } from './section-shell';

/**
 * Section typographie : appariement Fraunces (display) / Figtree (texte)
 * pour le latin, IBM Plex Sans Arabic pour l'arabe (titres ET corps,
 * graisse ≥ 600, jamais d'italique). Échelle modulaire ratio 1.25.
 */

/** Échelle épelée (classes statiques) avec les valeurs des tokens. */
const TYPE_SCALE: Array<{ token: string; px: string; className: string; role: string }> = [
  { token: '6xl', px: '76,3 px', className: 'text-6xl', role: 'Affichage exceptionnel' },
  { token: '5xl', px: '61 px', className: 'text-5xl', role: 'Hero' },
  { token: '4xl', px: '48,8 px', className: 'text-4xl', role: 'H1' },
  { token: '3xl', px: '39 px', className: 'text-3xl', role: 'H2' },
  { token: '2xl', px: '31,25 px', className: 'text-2xl', role: 'H3' },
  { token: 'xl', px: '25 px', className: 'text-xl', role: 'H4' },
  { token: 'lg', px: '20 px', className: 'text-lg', role: 'Lead' },
  { token: 'base', px: '16 px', className: 'text-base', role: 'Corps de référence' },
  { token: 'sm', px: '14 px', className: 'text-sm', role: 'UI dense' },
  { token: 'xs', px: '12,8 px', className: 'text-xs', role: 'Légendes' },
  { token: '2xs', px: '10,24 px', className: 'text-2xs', role: 'Mentions' },
];

const WEIGHTS: Array<{ label: string; value: string; className: string }> = [
  { label: 'Regular', value: '400', className: 'font-normal' },
  { label: 'Medium', value: '500', className: 'font-medium' },
  { label: 'Semibold', value: '600', className: 'font-semibold' },
  { label: 'Bold', value: '700', className: 'font-bold' },
];

/** Spécimen français : serif expressive + sans humaniste. */
function SpecimenLatin() {
  return (
    <div className="flex flex-col gap-4">
      <ExampleLabel>Latin — Fraunces (titres) · Figtree (corps)</ExampleLabel>
      <div dir="ltr" lang="fr" className="flex flex-col gap-3 rounded-md border border-border/60 bg-surface p-6">
        <p className="text-2xs font-semibold uppercase tracking-widest text-accent">Studio SallyCourse</p>
        <p className="font-display text-4xl font-semibold text-foreground">
          Le savoir, mis en scène.
        </p>
        <p className="max-w-prose text-base text-muted">
          D&apos;un simple titre naît un cours complet — vidéos, articles, travaux pratiques
          et quiz orchestrés comme une production de studio. La typographie donne le ton&nbsp;:
          une serif expressive pour l&apos;émotion, une sans humaniste pour la clarté.
        </p>
        <p className="text-sm text-muted">
          Chiffres élégants en display&nbsp;: <span className="font-display text-lg text-foreground">1&nbsp;250 apprenants · 4,9/5</span>
        </p>
      </div>
    </div>
  );
}

/** Spécimen arabe : IBM Plex Sans Arabic, RTL natif, graisse ≥ 600 en titre. */
function SpecimenArabe() {
  return (
    <div className="flex flex-col gap-4">
      <ExampleLabel>Arabe — IBM Plex Sans Arabic (titres et corps, jamais d&apos;italique)</ExampleLabel>
      <div dir="rtl" lang="ar" className="flex flex-col gap-3 rounded-md border border-border/60 bg-surface p-6 font-arabic">
        <p className="text-2xs font-semibold tracking-wide text-accent">استوديو سالي كورس</p>
        <p className="text-4xl font-bold text-foreground">المعرفة تُروى كقصة.</p>
        <p className="max-w-prose text-base leading-relaxed text-muted">
          من عنوان واحد تولد دورة كاملة — فيديوهات ومقالات وتمارين تطبيقية واختبارات،
          منسّقة كإنتاج استوديو احترافي. الخطّ العربي يحمل العنوان والنص معًا بوزن
          واضح، دون مائل أبدًا.
        </p>
        <p className="text-sm font-semibold text-foreground">١٢٥٠ متعلّمًا · تقييم ٤٫٩ من ٥</p>
      </div>
    </div>
  );
}

/** Échelle modulaire rendue taille par taille. */
function ScaleTable() {
  return (
    <div className="flex flex-col gap-3">
      <ExampleLabel>Échelle modulaire — ratio 1,25 (quarte majeure), base 16 px</ExampleLabel>
      <ul className="flex flex-col divide-y divide-border/60 rounded-md border border-border/60 bg-surface">
        {TYPE_SCALE.map((step) => (
          <li key={step.token} className="flex items-baseline gap-4 overflow-hidden px-4 py-3 sm:px-6">
            <span className="w-12 shrink-0 text-2xs font-bold uppercase tracking-wide text-accent">
              {step.token}
            </span>
            <span className="w-16 shrink-0 text-2xs text-muted">{step.px}</span>
            <span className={`${step.className} min-w-0 truncate font-display text-foreground`}>
              Aa — Studio
            </span>
            <span className="ms-auto hidden shrink-0 text-2xs text-muted sm:block">{step.role}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Graisses couvertes par Figtree et IBM Plex Sans Arabic. */
function WeightsRow() {
  return (
    <div className="flex flex-col gap-3">
      <ExampleLabel>Graisses standardisées</ExampleLabel>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {WEIGHTS.map((weight) => (
          <div key={weight.value} className="flex flex-col gap-1 rounded-md border border-border/60 bg-surface p-4">
            <span className={`${weight.className} text-2xl text-foreground`}>Aa</span>
            <span className="text-2xs text-muted">
              {weight.label} · {weight.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Règles d'appariement FR ↔ AR issues des tokens (fontPairing). */
function PairingRules() {
  return (
    <div className="flex flex-col gap-3">
      <ExampleLabel>Règles d&apos;appariement</ExampleLabel>
      <ul className="flex flex-col gap-2 rounded-md border border-border/60 bg-surface p-5 text-sm text-muted">
        <li className="flex gap-2">
          <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-400" />
          FR/EN&nbsp;: titres en <strong className="font-semibold text-foreground">font-display</strong> (Fraunces),
          corps en <strong className="font-semibold text-foreground">font-sans</strong> (Figtree).
        </li>
        <li className="flex gap-2">
          <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-400" />
          AR&nbsp;: titres ET corps en <strong className="font-semibold text-foreground">font-arabic</strong> —
          graisse ≥ 600 pour les titres, jamais de serif ni d&apos;italique.
        </li>
        <li className="flex gap-2">
          <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-400" />
          Texte mixte&nbsp;: la famille suit la langue dominante du bloc, les fallbacks couvrent
          les insertions ponctuelles de l&apos;autre écriture.
        </li>
      </ul>
    </div>
  );
}

export function TypographySection() {
  return (
    <StyleSection
      id="typographie"
      index={2}
      title="Typographie"
      lead="Fraunces incarne la voix éditoriale, Figtree porte la lecture, IBM Plex Sans Arabic assume l'arabe seul — titres et corps. Une échelle modulaire de ratio 1,25 rythme l'ensemble."
    >
      <PreviewFrame>
        <div className="flex flex-col gap-10">
          <div className="grid gap-6 lg:grid-cols-2">
            <SpecimenLatin />
            <SpecimenArabe />
          </div>
          <ScaleTable />
          <WeightsRow />
          <PairingRules />
        </div>
      </PreviewFrame>
    </StyleSection>
  );
}
