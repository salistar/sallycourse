'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
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

const DURATION_ROWS: Array<{ token: string; value: string; className: string; usageKey: string }> = [
  { token: 'instant', value: durations.instant, className: 'duration-instant', usageKey: 'dur.instant' },
  { token: 'fast', value: durations.fast, className: 'duration-fast', usageKey: 'dur.fast' },
  { token: 'base', value: durations.base, className: 'duration-base', usageKey: 'dur.base' },
  { token: 'slow', value: durations.slow, className: 'duration-slow', usageKey: 'dur.slow' },
  { token: 'slower', value: durations.slower, className: 'duration-slower', usageKey: 'dur.slower' },
];

const EASING_ROWS: Array<{ token: string; value: string; className: string; usageKey: string }> = [
  { token: 'standard', value: easings.standard, className: 'ease-standard duration-slower', usageKey: 'ease.standard' },
  { token: 'out', value: easings.out, className: 'ease-out duration-slower', usageKey: 'ease.out' },
  { token: 'in', value: easings.in, className: 'ease-in duration-slower', usageKey: 'ease.in' },
  { token: 'spring', value: easings.spring, className: 'ease-spring duration-slower', usageKey: 'ease.spring' },
];

const ENTRANCE_ROWS: Array<{ token: string; className: string; usageKey: string }> = [
  { token: 'animate-fade-in', className: 'animate-fade-in', usageKey: 'entrance.fadeIn' },
  { token: 'animate-fade-in-up', className: 'animate-fade-in-up', usageKey: 'entrance.fadeInUp' },
  { token: 'animate-scale-in', className: 'animate-scale-in', usageKey: 'entrance.scaleIn' },
];

/** Piste de course : une bille par ligne, aller-retour au clic. */
function RaceTrack({
  rows,
  legend,
  note,
}: {
  rows: Array<{ token: string; value: string; className: string; usageKey: string }>;
  legend: string;
  note: string;
}) {
  const t = useTranslations('design.motion');
  const [away, setAway] = React.useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ExampleLabel>{legend}</ExampleLabel>
        <Button variant="secondary" size="sm" onClick={() => setAway((v) => !v)}>
          <ArrowLeftRight aria-hidden="true" />
          {away ? t('back') : t('start')}
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
              <span className="font-medium text-foreground">{row.value}</span> · {t(row.usageKey)}
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
  const t = useTranslations('design.motion');
  const [runKey, setRunKey] = React.useState(0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ExampleLabel>{t('entranceLabel')}</ExampleLabel>
        <Button variant="secondary" size="sm" onClick={() => setRunKey((k) => k + 1)}>
          <RotateCcw aria-hidden="true" />
          {t('replay')}
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
              <span className="text-2xs text-muted">{t(row.usageKey)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MotionSection() {
  const t = useTranslations('design.motion');
  return (
    <StyleSection
      id="motion"
      index={4}
      title={t('title')}
      lead={t('lead')}
    >
      <PreviewFrame>
        <div className="flex flex-col gap-10">
          <RaceTrack
            rows={DURATION_ROWS}
            legend={t('durationsLegend')}
            note={t('durationsNote')}
          />
          <RaceTrack
            rows={EASING_ROWS}
            legend={t('easingsLegend')}
            note={t('easingsNote')}
          />
          <EntranceShowcase />
        </div>
      </PreviewFrame>
    </StyleSection>
  );
}
