import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * Carte SALISTAR — bordure dégradée 1px violet → or (technique du wrapper
 * `p-px` en dégradé, contenu posé sur `bg-surface`) et élévation au survol
 * lorsque `interactive` est actif.
 */
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Active la levée + l'intensification du dégradé au survol. */
  interactive?: boolean;
  /** Classes appliquées au wrapper extérieur (marges, largeur…). */
  wrapperClassName?: string;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, wrapperClassName, interactive = false, children, ...props }, ref) => (
    <div
      className={cn(
        'group/card relative rounded-lg bg-gradient-to-br from-primary-500/50 via-border to-accent-400/50 p-px shadow-sm',
        'transition-all duration-base ease-standard',
        interactive &&
          'hover:-translate-y-0.5 hover:from-primary-400/80 hover:via-primary-500/30 hover:to-accent-400/80 hover:shadow-lg',
        wrapperClassName,
      )}
    >
      <div ref={ref} className={cn('h-full rounded-[calc(1rem-1px)] bg-surface', className)} {...props}>
        {children}
      </div>
    </div>
  ),
);
Card.displayName = 'Card';

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-1.5 p-6 pb-4', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

export const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn('font-display text-xl font-semibold text-foreground', className)} {...props} />
  ),
);
CardTitle.displayName = 'CardTitle';

export const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-sm text-muted', className)} {...props} />
  ),
);
CardDescription.displayName = 'CardDescription';

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />,
);
CardContent.displayName = 'CardContent';

export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center gap-3 p-6 pt-0', className)} {...props} />
  ),
);
CardFooter.displayName = 'CardFooter';
