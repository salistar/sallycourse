import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * Squelette de chargement SALISTAR — fond violet doux + balayage lumineux
 * (shimmer) : un voile en dégradé translate de gauche à droite en boucle
 * (keyframe `shimmer` déclarée dans tailwind.config.ts).
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn('relative overflow-hidden rounded-md bg-primary-soft/70', className)}
      {...props}
    >
      <span className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-primary-400/20 to-transparent" />
    </div>
  );
}
