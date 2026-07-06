'use client';

/**
 * GenerationTimeline — timeline verticale générique d'un processus par
 * étapes (génération de cours : analyse → plan → rédaction → quiz…).
 *
 * Langage du mouvement :
 * - le rail vertical « se remplit » organiquement au rythme des étapes ;
 * - l'étape active PULSE (le système travaille) ;
 * - chaque étape terminée reçoit sa coche avec un ressort vif (réussite) ;
 * - un échec fige le rail et marque l'étape en danger.
 */

import * as React from 'react';
import { motion } from 'framer-motion';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { motionDurations, motionEasings, transitions, usePrefersReducedMotion } from './motion-config';

export interface GenerationStep {
  /** Identifiant stable (clé React). */
  id: string;
  /** Intitulé court de l'étape. */
  label: string;
  /** Précision optionnelle affichée sous l'intitulé. */
  description?: string;
}

export type GenerationTimelineStatus = 'idle' | 'running' | 'done' | 'failed';

type StepState = 'pending' | 'active' | 'done' | 'failed';

export interface GenerationTimelineProps {
  /** Étapes ordonnées du processus. */
  steps: GenerationStep[];
  /**
   * Index (0-based) de l'étape en cours. Les étapes strictement
   * antérieures sont considérées terminées.
   */
  currentIndex: number;
  /** État global du processus (défaut : 'running'). */
  status?: GenerationTimelineStatus;
  className?: string;
}

/** Résout l'état visuel d'une étape à partir de l'état global. */
function resolveStepState(index: number, currentIndex: number, status: GenerationTimelineStatus): StepState {
  if (status === 'idle') return 'pending';
  if (status === 'done') return 'done';
  if (index < currentIndex) return 'done';
  if (index === currentIndex) return status === 'failed' ? 'failed' : 'active';
  return 'pending';
}

export function GenerationTimeline({
  steps,
  currentIndex,
  status = 'running',
  className,
}: GenerationTimelineProps) {
  const prefersReducedMotion = usePrefersReducedMotion();

  // Fraction de remplissage du rail : proportion d'étapes ATTEINTES
  // (les segments relient les pastilles ; N étapes → N-1 segments).
  const reached =
    status === 'done'
      ? steps.length - 1
      : status === 'idle'
        ? 0
        : Math.min(Math.max(currentIndex, 0), steps.length - 1);
  const fillFraction = steps.length > 1 ? reached / (steps.length - 1) : status === 'done' ? 1 : 0;

  return (
    <ol className={cn('relative m-0 list-none space-y-6 p-0', className)} aria-label="Progression de la génération">
      {/* Rail : piste discrète + remplissage dégradé violet → or */}
      <div aria-hidden="true" className="absolute bottom-3 start-3 top-3 w-0.5 -translate-x-1/2 rounded-full bg-border rtl:translate-x-1/2">
        <motion.div
          className="w-full origin-top rounded-full bg-gradient-to-b from-primary-500 to-accent-400"
          initial={false}
          animate={{ height: `${fillFraction * 100}%` }}
          transition={
            prefersReducedMotion
              ? { duration: 0 }
              : { duration: motionDurations.slow, ease: motionEasings.out }
          }
        />
      </div>

      {steps.map((step, index) => {
        const state = resolveStepState(index, currentIndex, status);
        return (
          <li key={step.id} className="relative flex items-start gap-4 ps-0" aria-current={state === 'active' ? 'step' : undefined}>
            {/* Pastille d'état */}
            <span className="relative z-10 flex size-6 shrink-0 items-center justify-center">
              {state === 'done' && (
                <motion.span
                  className="flex size-6 items-center justify-center rounded-full bg-success text-success-foreground shadow-sm"
                  initial={prefersReducedMotion ? false : { scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={transitions.springSnappy}
                >
                  <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
                </motion.span>
              )}

              {state === 'failed' && (
                <motion.span
                  className="flex size-6 items-center justify-center rounded-full bg-danger text-danger-foreground shadow-sm"
                  initial={prefersReducedMotion ? false : { scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={transitions.springSnappy}
                >
                  <X className="size-3.5" strokeWidth={3} aria-hidden="true" />
                </motion.span>
              )}

              {state === 'active' && (
                <>
                  {/* Halo qui respire — « le système travaille » */}
                  {!prefersReducedMotion && (
                    <motion.span
                      aria-hidden="true"
                      className="absolute inset-0 rounded-full bg-primary/40"
                      animate={{ scale: [1, 1.9], opacity: [0.5, 0] }}
                      transition={{ duration: 1.4, ease: motionEasings.out, repeat: Infinity }}
                    />
                  )}
                  <span className="flex size-6 items-center justify-center rounded-full border-2 border-primary bg-primary-soft">
                    <motion.span
                      className="size-2 rounded-full bg-primary"
                      animate={prefersReducedMotion ? undefined : { scale: [1, 1.35, 1] }}
                      transition={{ duration: 1.4, ease: motionEasings.standard, repeat: Infinity }}
                    />
                  </span>
                </>
              )}

              {state === 'pending' && (
                <span className="size-6 rounded-full border-2 border-border bg-surface" />
              )}
            </span>

            {/* Libellés — la hiérarchie typographique suit l'état */}
            <div className="min-w-0 pt-0.5">
              <p
                className={cn(
                  'text-sm transition-colors duration-base',
                  state === 'active' && 'font-semibold text-foreground',
                  state === 'done' && 'font-medium text-foreground',
                  state === 'failed' && 'font-semibold text-danger',
                  state === 'pending' && 'text-muted',
                )}
              >
                {step.label}
              </p>
              {step.description && (
                <p className={cn('mt-0.5 text-xs', state === 'pending' ? 'text-muted/70' : 'text-muted')}>
                  {step.description}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
