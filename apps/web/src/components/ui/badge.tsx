import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * Badge de statut SALISTAR — pensé pour le cycle de vie d'un cours généré :
 * draft → generating (pastille pulsée) → ready (or) / failed → published.
 * Pastille indicatrice intégrée, texte en capitales espacées.
 */
export const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-2xs font-semibold uppercase tracking-wide transition-colors duration-fast',
  {
    variants: {
      variant: {
        /** Génération IA en cours — pastille animée (ping). */
        generating: 'border-info/40 bg-info/10 text-info',
        /** Cours prêt — moment de valeur : accent OR. */
        ready: 'border-accent/50 bg-accent/15 text-accent shadow-sm',
        /** Échec de génération. */
        failed: 'border-danger/40 bg-danger/10 text-danger',
        /** Brouillon — neutre discret. */
        draft: 'border-border bg-surface-subtle text-muted',
        /** Publié — visible des apprenants. */
        published: 'border-success/40 bg-success/10 text-success',
      },
    },
    defaultVariants: {
      variant: 'draft',
    },
  },
);

/** Couleur de pastille alignée sur chaque variante. */
const DOT_STYLES: Record<NonNullable<VariantProps<typeof badgeVariants>['variant']>, string> = {
  generating: 'bg-info',
  ready: 'bg-accent',
  failed: 'bg-danger',
  draft: 'bg-muted',
  published: 'bg-success',
};

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Masque la pastille indicatrice. */
  hideDot?: boolean;
}

export function Badge({ className, variant = 'draft', hideDot = false, children, ...props }: BadgeProps) {
  const resolved = variant ?? 'draft';
  return (
    <span className={cn(badgeVariants({ variant: resolved }), className)} {...props}>
      {!hideDot && (
        <span aria-hidden="true" className="relative flex h-1.5 w-1.5">
          {/* Halo pulsé uniquement pendant la génération */}
          {resolved === 'generating' && (
            <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-75', DOT_STYLES[resolved])} />
          )}
          <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', DOT_STYLES[resolved])} />
        </span>
      )}
      {children}
    </span>
  );
}
