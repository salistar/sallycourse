import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * État vide SALISTAR — illustration géométrique SVG intégrée (constellation
 * de formes violet/or, aucun asset externe), titre serif et action optionnelle.
 */
export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  /** Action(s) proposée(s) — typiquement un <Button>. */
  action?: React.ReactNode;
}

/** Illustration décorative — formes géométriques aux couleurs de la marque. */
function GeometricIllustration() {
  return (
    <svg
      viewBox="0 0 200 140"
      width={200}
      height={140}
      aria-hidden="true"
      className="mx-auto"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Halo de fond */}
      <circle cx="100" cy="70" r="56" className="fill-primary-soft/60" />
      <circle cx="100" cy="70" r="56" className="stroke-primary-400/30" strokeWidth="1" strokeDasharray="4 6" />
      {/* Grand losange violet */}
      <rect
        x="76" y="46" width="48" height="48" rx="10"
        transform="rotate(45 100 70)"
        className="fill-primary/15 stroke-primary-400/70"
        strokeWidth="1.5"
      />
      {/* Losange intérieur or */}
      <rect
        x="88" y="58" width="24" height="24" rx="6"
        transform="rotate(45 100 70)"
        className="fill-accent/20 stroke-accent-400"
        strokeWidth="1.5"
      />
      {/* Orbites et satellites */}
      <circle cx="42" cy="38" r="5" className="fill-primary-400/50" />
      <circle cx="160" cy="34" r="3.5" className="stroke-accent-400" strokeWidth="1.5" />
      <circle cx="168" cy="98" r="5" className="fill-accent-400/40" />
      <circle cx="34" cy="102" r="3" className="stroke-primary-400/70" strokeWidth="1.5" />
      {/* Triangle */}
      <path d="M150 118 l7 12 h-14 z" className="fill-primary-400/40" />
      {/* Éclat en croix (étincelle or) */}
      <path
        d="M56 112 v10 M51 117 h10"
        className="stroke-accent-400"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M148 56 v7 M144.5 59.5 h7"
        className="stroke-primary-300"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function EmptyState({ title, description, action, className, ...props }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 rounded-lg border border-dashed border-border',
        'bg-surface-subtle/50 px-8 py-12 text-center',
        className,
      )}
      {...props}
    >
      <GeometricIllustration />
      <h3 className="mt-2 font-display text-xl font-semibold text-foreground">{title}</h3>
      {description && <p className="max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-4 flex flex-wrap items-center justify-center gap-3">{action}</div>}
    </div>
  );
}
