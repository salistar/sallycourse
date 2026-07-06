'use client';

import * as React from 'react';
import { PreviewFrame } from './preview-frame';
import { ExampleLabel, StyleSection } from './section-shell';

/**
 * Section fondations : espacements (grille 4 px stricte), rayons de
 * bordure et ombres teintées violet — les invariants silencieux qui
 * donnent au produit sa tenue de studio.
 */

/** Échelle d'espacement — classes de largeur épelées (purge Tailwind). */
const SPACING_STEPS: Array<{ token: string; px: string; barClass: string }> = [
  { token: '0.5', px: '2 px', barClass: 'w-0.5' },
  { token: '1', px: '4 px', barClass: 'w-1' },
  { token: '2', px: '8 px', barClass: 'w-2' },
  { token: '3', px: '12 px', barClass: 'w-3' },
  { token: '4', px: '16 px', barClass: 'w-4' },
  { token: '6', px: '24 px', barClass: 'w-6' },
  { token: '8', px: '32 px', barClass: 'w-8' },
  { token: '12', px: '48 px', barClass: 'w-12' },
  { token: '16', px: '64 px', barClass: 'w-16' },
  { token: '24', px: '96 px', barClass: 'w-24' },
  { token: '32', px: '128 px', barClass: 'w-32' },
];

const RADII_STEPS: Array<{ token: string; px: string; className: string; usage: string }> = [
  { token: 'sm', px: '8 px', className: 'rounded-sm', usage: 'Boutons, inputs, badges' },
  { token: 'md (défaut)', px: '12 px', className: 'rounded-md', usage: 'Cartes, dropdowns' },
  { token: 'lg', px: '16 px', className: 'rounded-lg', usage: 'Modales, panneaux' },
  { token: 'xl', px: '24 px', className: 'rounded-xl', usage: 'Blocs hero, illustrations' },
  { token: 'full', px: 'pill', className: 'rounded-full', usage: 'Pills, avatars' },
];

const SHADOW_STEPS: Array<{ token: string; className: string; usage: string }> = [
  { token: 'shadow-sm', className: 'shadow-sm', usage: 'Relief discret (inputs)' },
  { token: 'shadow-md', className: 'shadow-md', usage: 'Cartes au repos' },
  { token: 'shadow-lg', className: 'shadow-lg', usage: 'Cartes survolées, popovers' },
  { token: 'shadow-xl', className: 'shadow-xl', usage: 'Modales, panneaux flottants' },
  { token: 'shadow-glow', className: 'shadow-glow', usage: 'Halo premium — CTA, mise en avant' },
];

function SpacingScale() {
  return (
    <div className="flex flex-col gap-3">
      <ExampleLabel>Espacements — grille 4 px stricte (seule exception : 2 px)</ExampleLabel>
      <ul className="flex flex-col gap-2 rounded-md border border-border/60 bg-surface p-5">
        {SPACING_STEPS.map((step) => (
          <li key={step.token} className="flex items-center gap-4">
            <span className="w-8 shrink-0 text-2xs font-bold text-accent">{step.token}</span>
            {/* Barre à la largeur exacte du token (grille logique : flippe en RTL) */}
            <span
              aria-hidden="true"
              className={`${step.barClass} h-2.5 shrink-0 rounded-full bg-gradient-to-r from-primary-500 to-primary-400/60`}
            />
            <span className="text-2xs text-muted">{step.px}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RadiiScale() {
  return (
    <div className="flex flex-col gap-3">
      <ExampleLabel>Rayons — trois crans structurants (8 / 12 / 16) + xl et pill</ExampleLabel>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {RADII_STEPS.map((step) => (
          <div key={step.token} className="flex flex-col items-start gap-2 rounded-md border border-border/60 bg-surface p-4">
            <div
              aria-hidden="true"
              className={`${step.className} h-14 w-full border border-primary-400/50 bg-primary-soft`}
            />
            <span className="text-xs font-semibold text-foreground">{step.token}</span>
            <span className="text-2xs text-muted">
              {step.px} · {step.usage}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShadowsScale() {
  return (
    <div className="flex flex-col gap-3">
      <ExampleLabel>Ombres — toujours teintées violet, jamais de noir pur</ExampleLabel>
      <div className="grid grid-cols-2 gap-4 rounded-md border border-border/60 bg-surface-subtle p-5 sm:grid-cols-3 lg:grid-cols-5 lg:p-8">
        {SHADOW_STEPS.map((step) => (
          <div key={step.token} className="flex flex-col gap-2">
            <div
              aria-hidden="true"
              className={`${step.className} h-20 rounded-md border border-border/40 bg-surface`}
            />
            <span className="text-xs font-semibold text-foreground">{step.token}</span>
            <span className="text-2xs text-muted">{step.usage}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted">
        En thème sombre les ombres s&apos;effacent au profit des liserés et halos&nbsp;: basculez en
        light pour lire toute la profondeur de l&apos;échelle.
      </p>
    </div>
  );
}

export function FoundationsSection() {
  return (
    <StyleSection
      id="fondations"
      index={3}
      title="Espacements · Rayons · Ombres"
      lead="Une grille de 4 px sans exception (ou presque), trois rayons structurants et des ombres teintées de violet profond : la matière discrète qui tient chaque écran."
    >
      <PreviewFrame>
        <div className="flex flex-col gap-10">
          <SpacingScale />
          <RadiiScale />
          <ShadowsScale />
        </div>
      </PreviewFrame>
    </StyleSection>
  );
}
