'use client';

/**
 * CountUp — nombre animé (statistiques, compteurs de résultats).
 * L'animation raconte l'accumulation ; elle démarre à l'entrée dans le
 * viewport et écrit directement dans le DOM (textContent) pour ne pas
 * déclencher un re-render React à chaque frame.
 *
 * Formatage localisé (fr-FR par défaut, gère AR/EN), chiffres tabulaires
 * pour éviter le tremblement, respect de prefers-reduced-motion
 * (valeur finale affichée directement).
 */

import * as React from 'react';
import { animate, useInView } from 'framer-motion';
import { cn } from '@/lib/cn';
import { motionEasings, usePrefersReducedMotion } from './motion-config';

export interface CountUpProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Valeur cible du compteur. */
  value: number;
  /** Valeur de départ (défaut : 0). */
  from?: number;
  /** Durée de l'animation en millisecondes (défaut : 1200). */
  durationMs?: number;
  /** Nombre de décimales affichées. */
  decimals?: number;
  /** Préfixe collé à la valeur (ex. « + »). */
  prefix?: string;
  /** Suffixe collé à la valeur (ex. « h », « % »). */
  suffix?: string;
  /** Locale de formatage numérique. */
  locale?: string;
  /** Démarrer à l'entrée dans le viewport (défaut : true) ou immédiatement. */
  startOnView?: boolean;
}

export function CountUp({
  value,
  from = 0,
  durationMs = 1200,
  decimals = 0,
  prefix = '',
  suffix = '',
  locale = 'fr-FR',
  startOnView = true,
  className,
  ...props
}: CountUpProps) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const prefersReducedMotion = usePrefersReducedMotion();

  const format = React.useMemo(() => {
    const formatter = new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    return (n: number) => `${prefix}${formatter.format(n)}${suffix}`;
  }, [locale, decimals, prefix, suffix]);

  const shouldStart = startOnView ? inView : true;

  React.useEffect(() => {
    const node = ref.current;
    if (!node || !shouldStart) return;

    // Mouvement réduit : on pose la valeur finale sans transition.
    if (prefersReducedMotion) {
      node.textContent = format(value);
      return;
    }

    const controls = animate(from, value, {
      duration: durationMs / 1000,
      ease: motionEasings.out,
      onUpdate: (latest) => {
        node.textContent = format(latest);
      },
    });
    return () => controls.stop();
  }, [shouldStart, from, value, durationMs, format, prefersReducedMotion]);

  return (
    // tabular-nums : la largeur des chiffres ne « saute » pas pendant l'animation
    <span ref={ref} className={cn('tabular-nums', className)} {...props}>
      {/* Rendu initial (SSR) : valeur de départ formatée, remplacée à l'entrée en vue. */}
      {format(from)}
    </span>
  );
}
