import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * Champ texte SALISTAR à label flottant : le label repose au centre du champ
 * puis se réduit vers le haut au focus ou dès qu'une valeur est présente
 * (technique `peer` + placeholder transparent — aucun JS d'état).
 * RTL natif via propriétés logiques (start/end).
 */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Label flottant (obligatoire pour l'accessibilité). */
  label: string;
  /** Message d'erreur — bascule le champ en état invalide. */
  error?: string;
  /** Aide contextuelle affichée sous le champ (masquée si erreur). */
  hint?: string;
  /** Classes du wrapper extérieur. */
  wrapperClassName?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, wrapperClassName, label, error, hint, id, placeholder, ...props }, ref) => {
    const autoId = React.useId();
    const inputId = id ?? autoId;
    const messageId = `${inputId}-message`;
    const message = error ?? hint;

    return (
      <div className={cn('flex flex-col gap-1.5', wrapperClassName)}>
        <div className="relative">
          <input
            ref={ref}
            id={inputId}
            // Placeholder « espace » requis pour piloter :placeholder-shown
            placeholder={placeholder ?? ' '}
            aria-invalid={error ? true : undefined}
            aria-describedby={message ? messageId : undefined}
            className={cn(
              'peer h-13 w-full rounded-sm border border-input bg-surface px-4 pb-1.5 pt-5',
              'text-sm text-foreground placeholder-transparent shadow-sm',
              'transition-colors duration-fast ease-standard',
              'hover:border-ring/50',
              'focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/35',
              'disabled:cursor-not-allowed disabled:opacity-50',
              error && 'border-danger focus:border-danger focus:ring-danger/30',
              className,
            )}
            {...props}
          />
          <label
            htmlFor={inputId}
            className={cn(
              'pointer-events-none absolute start-4 top-1/2 -translate-y-1/2',
              'text-sm text-muted transition-all duration-fast ease-out',
              // État flotté : au focus OU dès qu'une valeur est saisie
              'peer-focus:top-3 peer-focus:translate-y-0 peer-focus:text-2xs peer-focus:font-semibold peer-focus:text-primary',
              'peer-[:not(:placeholder-shown)]:top-3 peer-[:not(:placeholder-shown)]:translate-y-0 peer-[:not(:placeholder-shown)]:text-2xs peer-[:not(:placeholder-shown)]:font-semibold',
              error && 'text-danger peer-focus:text-danger',
            )}
          >
            {label}
          </label>
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
Input.displayName = 'Input';
