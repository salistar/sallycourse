import type * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * Carte d'indicateur pour les tableaux de bord admin (P57) : libellé, valeur
 * proéminente et détail optionnel. Icône décorative facultative.
 */
export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}

export function StatCard({ label, value, hint, icon, className }: StatCardProps) {
  return (
    <div className={cn('rounded-lg border border-border bg-surface/60 p-5', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs font-semibold uppercase tracking-wide text-muted">{label}</span>
        {icon ? (
          <span className="text-muted [&_svg]:size-4" aria-hidden="true">
            {icon}
          </span>
        ) : null}
      </div>
      <p className="mt-2 font-display text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
