'use client';

import * as React from 'react';
import { ArrowLeftRight, RotateCcw } from 'lucide-react';
// Sous-module direct (pas le baril) : évite d'embarquer render-templates.ts
// (Node-only, node:url) dans le bundle navigateur d'un composant client.
import { durations, easings } from '@sallycourse/design/tokens';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui';
import { PreviewFrame } from './preview-frame';
import { ExampleLabel, StyleSection } from './section-shell';

/**
 * Section motion : durées et courbes DÉMONTRÉES en direct. Les billes se
 * déplacent en margin-inline-start (et non translate-x) pour que la
 * démonstration s'inverse naturellement en RTL. `prefers-reduced-motion`
 * est respecté globalement (voir globals.css).
 */

const DURATION_ROWS: Array<{ token: string; value: string; className: string; usage: string }> = [
  { token: 'instant', value: durations.instant, className: 'duration-instant', usage: 'Feedback pressé' },
  { token: 'fast', value: durations.fast, className: 'duration-fast', usage: 'Hover, focus' },
  { token: 'base', value: durations.base, className: 'duration-base', usage: 'Transitions par défaut' },
  { token: 'slow', value: durations.slow, className: 'duration-slow', usage: 'Entrées de panneaux' },
  { token: 'slower', value: durations.slower, className: 'duration-slower', usage: 'Séquences orchestrées' },
];

const EASING_ROWS: Array<{ token: string; value: string; className: string; usage: string }> = [
  { token: 'standard', value: easings.standard, className: 'ease-standard duration-slower', usage: 'Courbe par défaut' },
  { token: 'out', value: easings.out, className: 'ease-out duration-slower', usage: 'Entrées (décélération)' },
  { token: 'in', value: easings.in, className: 'ease-in duration-slower', usage: 'Sorties (accélération)' },
  { token: 'spring', value: easings.spring, className: 'ease-spring duration-slower', usage: 'Célébrations, badges' },
];

const ENTRANCE_ROWS: Array<{ token: string; className: string; usage: string }> = [
  { token: 'animate-fade-in', className: 'animate-fade-in', usage: 'Apparitions discrètes' },
  { token: 'animate-fade-in-up', className: 'animate-fade-in-up', usage: 'Contenu qui se pose' },
  { token: 'animate-scale-in', className: 'animate-scale-in', usage: 'Modales, célébrations' },
];

/** Piste de course : une bille par ligne, aller-retour au clic. */
function RaceTrack({
  rows,
  legend,
  note,
}: {
  rows: Array<{ token: string; value: string; className: string; usage: string }>;
  legend: string;
  note: string;
}) {
  const [away, setAway] = React.useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ExampleLabel>{legend}</ExampleLabel>
        <Button variant="secondary" size="sm" onClick={() => setAway((v) => !v)}>
          <ArrowLeftRight aria-hidden="true" />
          {away ? 'Retour' : 'Lancer'}
        </Button>
      </div>
      <ul className="flex flex-col gap-3 rounded-md border border-border/60 bg-surface p-5">
        {rows.map((row) => (
          <li key={row.token} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
            <span className="w-24 shrink-0 text-2xs font-bold text-accent">{row.token}</span>
            <div className="w-64 max-w-full rounded-full bg-surface-subtle px-1 py-1">
              <div
                aria-hidden="true"
                className={cn(
                  'h-4 w-4 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 shadow-glow',
                  'transition-[margin] motion-reduce:transition-none',
                  row.className,
                  away ? 'ms-56' : 'ms-0',
                )}
              />
            </div>
            <span className="text-2xs text-muted">
              <span className="font-medium text-foreground">{row.value}</span> · {row.usage}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">{note}</p>
    </div>
  );
}

/** Animations d'entrée standard, rejouées en remontant les cartes (clé React). */
function EntranceShowcase() {
  const [runKey, setRunKey] = React.useState(0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ExampleLabel>Animations d&apos;entrée standard</ExampleLabel>
        <Button variant="secondary" size="sm" onClick={() => setRunKey((k) => k + 1)}>
          <RotateCcw aria-hidden="true" />
          Rejouer
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {ENTRANCE_ROWS.map((row) => (
          <div
            key={`${row.token}-${runKey}`}
            className={cn(
              'flex h-28 flex-col justify-between rounded-md border border-border/60 bg-surface p-4 motion-reduce:animate-none',
              row.className,
            )}
          >
            <span
              aria-hidden="true"
              className="h-8 w-8 rounded-full bg-gradient-to-br from-primary-500/30 to-accent-400/30"
            />
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-semibold text-foreground">{row.token}</span>
              <span className="text-2xs text-muted">{row.usage}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MotionSection() {
  return (
    <StyleSection
      id="motion"
      index={4}
      title="Motion"
      lead="Cinq durées, quatre courbes, trois entrées : un vocabulaire court et strict. Les micro-interactions restent sous 250 ms ; le spring est réservé aux célébrations. prefers-reduced-motion est toujours respecté."
    >
      <PreviewFrame>
        <div className="flex flex-col gap-10">
          <RaceTrack
            rows={DURATION_ROWS}
            legend="Durées — même courbe (standard), cinq tempos"
            note="Chaque bille court sur la même distance : seule la durée change. En RTL, la course s'inverse naturellement (déplacement en marge logique)."
          />
          <RaceTrack
            rows={EASING_ROWS}
            legend="Courbes — même durée (slower), quatre caractères"
            note="Observez le spring dépasser légèrement sa cible avant de se poser — à réserver aux moments de célébration."
          />
          <EntranceShowcase />
        </div>
      </PreviewFrame>
    </StyleSection>
  );
}
