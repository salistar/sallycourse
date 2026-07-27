'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

/**
 * Anneau de progression SVG — dégradé violet → or le long de l'arc,
 * pourcentage centré en chiffres tabulaires. Transition douce du trait
 * (stroke-dashoffset) quand la valeur évolue.
 */
export interface ProgressRingProps {
  /** Progression 0–100. */
  value: number;
  /** Diamètre en pixels (défaut : 44). */
  size?: number;
  /** Épaisseur du trait (défaut : 4). */
  strokeWidth?: number;
  /** Libellé accessible (défaut : « Progression »). */
  label?: string;
  className?: string;
}

export function ProgressRing({
  value,
  size = 44,
  strokeWidth = 4,
  label,
  className,
}: ProgressRingProps) {
  const t = useTranslations('dashboard.progressRing');
  const gradientId = React.useId();
  const resolvedLabel = label ?? t('label');
  const clamped = Math.min(100, Math.max(0, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  return (
    <span
      role="progressbar"
      aria-label={resolvedLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <defs>
          {/* Dégradé de marque : les stops héritent de currentColor via les classes de tokens */}
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="currentColor" className="text-primary-400" />
            <stop offset="100%" stopColor="currentColor" className="text-accent-400" />
          </linearGradient>
        </defs>
        {/* Piste discrète */}
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={strokeWidth} className="stroke-border" />
        {/* Arc de progression */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-slow ease-out"
        />
      </svg>
      <span className="absolute text-2xs font-semibold tabular-nums text-foreground">{Math.round(clamped)}</span>
    </span>
  );
}
