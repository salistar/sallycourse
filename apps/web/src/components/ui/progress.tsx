import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * Barre de progression SALISTAR — remplissage en dégradé violet → or animé
 * en continu (balayage de background-position), transition douce de la
 * largeur. Mode indéterminé si `value` est omis.
 */
export interface ProgressProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Progression 0–100. Omis = mode indéterminé. */
  value?: number;
  /** Libellé accessible (et affiché si `showLabel`). */
  label?: string;
  /** Affiche le libellé et le pourcentage au-dessus de la barre. */
  showLabel?: boolean;
}

export const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value, label, showLabel = false, ...props }, ref) => {
    const clamped = value === undefined ? undefined : Math.min(100, Math.max(0, value));
    const indeterminate = clamped === undefined;

    return (
      <div ref={ref} className={cn('flex w-full flex-col gap-1.5', className)} {...props}>
        {showLabel && (
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="font-medium text-muted">{label}</span>
            {!indeterminate && (
              <span className="font-semibold tabular-nums text-foreground">{Math.round(clamped)}%</span>
            )}
          </div>
        )}
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={indeterminate ? undefined : Math.round(clamped)}
          className="relative h-2 w-full overflow-hidden rounded-full bg-surface-subtle"
        >
          <div
            className={cn(
              'h-full rounded-full bg-gradient-to-r from-primary-600 via-primary-400 to-accent-400',
              'bg-[length:200%_100%] animate-gradient-pan',
              indeterminate
                ? 'absolute w-1/3 animate-progress-indeterminate'
                : 'transition-[width] duration-slow ease-out',
            )}
            style={indeterminate ? undefined : { width: `${clamped}%` }}
          />
        </div>
      </div>
    );
  },
);
Progress.displayName = 'Progress';
