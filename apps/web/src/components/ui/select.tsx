import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Sélecteur SALISTAR — élément natif `<select>` habillé (accessibilité et
 * comportement mobile natifs conservés), chevron décoratif positionné en
 * propriété logique pour un RTL correct.
 */
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** Label affiché au-dessus du champ. */
  label?: string;
  /** Message d'erreur — bascule le champ en état invalide. */
  error?: string;
  /** Aide contextuelle affichée sous le champ (masquée si erreur). */
  hint?: string;
  /** Classes du wrapper extérieur. */
  wrapperClassName?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, wrapperClassName, label, error, hint, id, children, ...props }, ref) => {
    const autoId = React.useId();
    const selectId = id ?? autoId;
    const messageId = `${selectId}-message`;
    const message = error ?? hint;

    return (
      <div className={cn('flex flex-col gap-1.5', wrapperClassName)}>
        {label && (
          <label htmlFor={selectId} className="px-1 text-xs font-semibold text-muted">
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            aria-invalid={error ? true : undefined}
            aria-describedby={message ? messageId : undefined}
            className={cn(
              'h-11 w-full cursor-pointer appearance-none rounded-sm border border-input bg-surface ps-4 pe-10',
              'text-sm text-foreground shadow-sm',
              'transition-colors duration-fast ease-standard',
              'hover:border-ring/50',
              'focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/35',
              'disabled:cursor-not-allowed disabled:opacity-50',
              error && 'border-danger focus:border-danger focus:ring-danger/30',
              className,
            )}
            {...props}
          >
            {children}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
          />
        </div>
        {message && (
          <p
            id={messageId}
            role={error ? 'alert' : undefined}
            className={cn('px-1 text-xs', error ? 'text-danger' : 'text-muted')}
          >
            {message}
          </p>
        )}
      </div>
    );
  },
);
Select.displayName = 'Select';
