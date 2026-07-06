'use client';

/**
 * Système de motion SALISTAR — configuration centrale.
 * Les durées et courbes proviennent EXCLUSIVEMENT des tokens du design
 * system (packages/design/src/tokens.ts) ; on les convertit ici au format
 * numérique attendu par Framer Motion (secondes + tuples cubic-bezier).
 *
 * Principe : chaque animation communique un état (entrée, progression,
 * réussite…). Rien de décoratif gratuit — et tout respecte
 * `prefers-reduced-motion` via <MotionProvider>.
 */

import * as React from 'react';
import { MotionConfig, useReducedMotion, type Transition, type Variants } from 'framer-motion';
import { durations, easings } from '@sallycourse/design/tokens';

/* ------------------------------------------------------------------ */
/* Conversion tokens → valeurs Framer Motion                           */
/* ------------------------------------------------------------------ */

/** '250ms' → 0.25 (Framer Motion travaille en secondes). */
const msToSeconds = (value: string): number => parseFloat(value) / 1000;

/** 'cubic-bezier(0.4, 0, 0.2, 1)' → [0.4, 0, 0.2, 1]. */
const toBezier = (value: string): [number, number, number, number] => {
  const nums = value.match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
  return [nums[0] ?? 0.4, nums[1] ?? 0, nums[2] ?? 0.2, nums[3] ?? 1];
};

/** Durées standard (en secondes), miroir exact de tokens.motion.durations. */
export const motionDurations = {
  instant: msToSeconds(durations.instant),
  fast: msToSeconds(durations.fast),
  base: msToSeconds(durations.base),
  slow: msToSeconds(durations.slow),
  slower: msToSeconds(durations.slower),
} as const;

/** Courbes standard (tuples bezier), miroir exact de tokens.motion.easings. */
export const motionEasings = {
  standard: toBezier(easings.standard),
  out: toBezier(easings.out),
  in: toBezier(easings.in),
  spring: toBezier(easings.spring),
} as const;

/* ------------------------------------------------------------------ */
/* Transitions prêtes à l'emploi                                       */
/* ------------------------------------------------------------------ */

/**
 * Transitions nommées par INTENTION, pas par valeur :
 * choisir celle qui correspond à ce que l'animation raconte.
 */
export const transitions = {
  /** Entrée d'élément — décélération douce. */
  enter: { duration: motionDurations.base, ease: motionEasings.out } satisfies Transition,
  /** Sortie d'élément — accélération, plus courte que l'entrée. */
  exit: { duration: motionDurations.fast, ease: motionEasings.in } satisfies Transition,
  /** Changement d'état en place (couleur, jauge…). */
  state: { duration: motionDurations.slow, ease: motionEasings.standard } satisfies Transition,
  /** Ressort doux — panneaux, cartes. */
  springSoft: { type: 'spring', stiffness: 260, damping: 26, mass: 0.9 } satisfies Transition,
  /** Ressort vif — badges, coches de validation (célébration contenue). */
  springSnappy: { type: 'spring', stiffness: 420, damping: 28, mass: 0.7 } satisfies Transition,
} as const;

/* ------------------------------------------------------------------ */
/* Variants partagés                                                   */
/* ------------------------------------------------------------------ */

/** Apparition simple — contenus secondaires. */
export const fadeInVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: transitions.enter },
};

/** Apparition + translation — cartes, sections, items de liste. */
export const fadeInUpVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: transitions.enter },
};

/** Apparition + zoom léger — modales, badges, éléments ponctuels. */
export const scaleInVariants: Variants = {
  hidden: { opacity: 0, scale: 0.94 },
  visible: { opacity: 1, scale: 1, transition: transitions.springSoft },
};

/* ------------------------------------------------------------------ */
/* Provider + accessibilité                                            */
/* ------------------------------------------------------------------ */

/**
 * Indique si l'utilisateur préfère un mouvement réduit.
 * À utiliser dans tout composant qui anime HORS de Framer Motion
 * (canvas, textContent…) — Framer gère déjà le reste via le provider.
 */
export function usePrefersReducedMotion(): boolean {
  return useReducedMotion() ?? false;
}

export interface MotionProviderProps {
  children: React.ReactNode;
}

/**
 * Provider global du système de motion.
 * - `reducedMotion="user"` : Framer Motion neutralise automatiquement les
 *   animations de transform quand `prefers-reduced-motion: reduce` est actif
 *   (les fondus d'opacité, non vestibulaire, sont conservés).
 * - transition par défaut = `transitions.enter` pour une cohérence globale.
 */
export function MotionProvider({ children }: MotionProviderProps) {
  return (
    <MotionConfig reducedMotion="user" transition={transitions.enter}>
      {children}
    </MotionConfig>
  );
}
