'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import type { Difficulty } from '@sallycourse/shared';
import { cn } from '@/lib/cn';
import { transitions } from '@/components/motion/motion-config';
import {
  AdvancedIllustration,
  BeginnerIllustration,
  IntermediateIllustration,
} from './level-illustrations';

/**
 * Sélecteur de niveau — trois grandes cartes illustrées (radiogroup ARIA
 * complet : roving tabindex + flèches, inversées en RTL). La carte choisie
 * reçoit une bordure dégradée violet → or et une pastille de validation.
 */

interface LevelDefinition {
  value: Difficulty;
  labelKey: string;
  taglineKey: string;
  descriptionKey: string;
  Illustration: (props: React.SVGProps<SVGSVGElement>) => React.JSX.Element;
}

const LEVELS: readonly LevelDefinition[] = [
  {
    value: 'beginner',
    labelKey: 'beginnerLabel',
    taglineKey: 'beginnerTagline',
    descriptionKey: 'beginnerDescription',
    Illustration: BeginnerIllustration,
  },
  {
    value: 'intermediate',
    labelKey: 'intermediateLabel',
    taglineKey: 'intermediateTagline',
    descriptionKey: 'intermediateDescription',
    Illustration: IntermediateIllustration,
  },
  {
    value: 'advanced',
    labelKey: 'advancedLabel',
    taglineKey: 'advancedTagline',
    descriptionKey: 'advancedDescription',
    Illustration: AdvancedIllustration,
  },
];

export interface LevelSelectorProps {
  value: Difficulty | null;
  onChange: (value: Difficulty) => void;
  /** Message d'erreur de validation (zod). */
  error?: string;
}

export function LevelSelector({ value, onChange, error }: LevelSelectorProps) {
  const t = useTranslations('create.level');
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const errorId = React.useId();

  /** Navigation clavier du radiogroup — flèches cycliques, sens inversé en RTL. */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const isRtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    let delta = 0;
    if (event.key === 'ArrowRight') delta = isRtl ? -1 : 1;
    else if (event.key === 'ArrowLeft') delta = isRtl ? 1 : -1;
    else if (event.key === 'ArrowDown') delta = 1;
    else if (event.key === 'ArrowUp') delta = -1;
    if (delta === 0) return;

    event.preventDefault();
    const next = (index + delta + LEVELS.length) % LEVELS.length;
    const nextLevel = LEVELS[next];
    if (!nextLevel) return;
    onChange(nextLevel.value);
    itemRefs.current[next]?.focus();
  };

  const selectedIndex = LEVELS.findIndex((level) => level.value === value);

  return (
    <div className="w-full">
      <div
        role="radiogroup"
        aria-label={t('groupLabel')}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="grid w-full gap-4 sm:grid-cols-3"
      >
        {LEVELS.map((level, index) => {
          const selected = value === level.value;
          // Roving tabindex : la carte sélectionnée (ou la première) porte le focus.
          const tabIndex = selected || (selectedIndex === -1 && index === 0) ? 0 : -1;

          return (
            <div
              key={level.value}
              className={cn(
                'rounded-lg p-px transition-all duration-base ease-standard',
                selected
                  ? 'bg-gradient-to-br from-primary-400 via-primary-600 to-accent-400 shadow-glow'
                  : 'bg-border hover:bg-gradient-to-br hover:from-primary-500/50 hover:via-border hover:to-accent-400/40',
              )}
            >
              <button
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={tabIndex}
                onClick={() => onChange(level.value)}
                onKeyDown={(event) => handleKeyDown(event, index)}
                className={cn(
                  'group relative flex h-full w-full flex-col items-center gap-3 rounded-[calc(1rem-1px)] px-5 pb-6 pt-7 text-center',
                  'transition-all duration-base ease-standard',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80',
                  'focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                  selected ? 'bg-surface' : 'bg-surface hover:-translate-y-0.5 hover:bg-surface-subtle',
                )}
              >
                {/* Pastille de validation — ressort vif à la sélection */}
                {selected && (
                  <motion.span
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={transitions.springSnappy}
                    className="absolute end-3 top-3 flex size-6 items-center justify-center rounded-full bg-gradient-to-b from-accent-300 to-accent-500 text-accent-foreground shadow-sm"
                    aria-hidden="true"
                  >
                    <Check className="size-3.5" strokeWidth={3} />
                  </motion.span>
                )}

                <level.Illustration
                  aria-hidden="true"
                  className={cn(
                    'h-20 w-28 transition-transform duration-slow ease-out',
                    'group-hover:scale-105',
                    selected && 'scale-105',
                  )}
                />

                <div>
                  <p
                    className={cn(
                      'font-display text-lg font-semibold transition-colors duration-fast',
                      selected ? 'text-foreground' : 'text-foreground/90',
                    )}
                  >
                    {t(level.labelKey)}
                  </p>
                  <p className="mt-0.5 text-2xs font-semibold uppercase tracking-widest text-accent-400/90">
                    {t(level.taglineKey)}
                  </p>
                </div>

                <p className="text-xs leading-relaxed text-muted">{t(level.descriptionKey)}</p>
              </button>
            </div>
          );
        })}
      </div>

      {error && (
        <p id={errorId} role="alert" className="mt-3 text-center text-sm text-danger animate-fade-in">
          {error}
        </p>
      )}
    </div>
  );
}
