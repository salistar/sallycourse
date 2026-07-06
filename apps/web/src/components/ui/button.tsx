import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Bouton SALISTAR — micro-animations intégrées :
 * - press : scale 0.98 (durée « instant » pour un feedback immédiat) ;
 * - focus clavier : halo OR (ring accent) décollé du fond ;
 * - hover : élévation/lueur selon la variante.
 */
export const buttonVariants = cva(
  [
    'group/button relative inline-flex select-none items-center justify-center gap-2',
    'whitespace-nowrap rounded-sm font-sans font-semibold',
    'transition-all duration-fast ease-standard',
    'active:scale-[0.98] active:duration-instant',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80',
    'focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    'disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:size-4 [&_svg]:shrink-0',
  ].join(' '),
  {
    variants: {
      variant: {
        /** Action principale — violet plein, lueur violette au survol. */
        primary: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:shadow-glow',
        /** Action secondaire — surface bordée, bordure teintée au survol. */
        secondary:
          'border border-border bg-surface text-foreground shadow-sm hover:border-ring/60 hover:bg-surface-subtle',
        /** Action discrète — texte seul, fond violet doux au survol. */
        ghost: 'text-muted hover:bg-primary-soft hover:text-foreground',
        /** Action destructive. */
        danger: 'bg-danger text-danger-foreground shadow-sm hover:bg-danger/90',
        /** Moment premium — dégradé or, à réserver aux mises en avant. */
        gold: 'bg-gradient-to-b from-accent-300 to-accent-500 text-accent-foreground shadow-md hover:from-accent-200 hover:to-accent-400 hover:shadow-glow',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-base',
        /** Bouton carré pour icône seule (penser à `aria-label`). */
        icon: 'h-10 w-10 p-0',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Affiche un spinner et neutralise le bouton pendant une action asynchrone. */
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading = false, disabled, children, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {loading && <Loader2 className="animate-spin" aria-hidden="true" />}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';
