import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * Zone de texte SALISTAR à label flottant — même mécanique `peer` que
 * l'Input ; le label se réduit vers le haut au focus ou quand une valeur
 * est présente. RTL natif (propriétés logiques).
 */
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Label flottant (obligatoire pour l'accessibilité). */
  label: string;
  /** Message d'erreur — bascule le champ en état invalide. */
  error?: string;
  /** Aide contextuelle affichée sous le champ (masquée si erreur). */
  hint?: string;
  /** Classes du wrapper extérieur. */
  wrapperClassName?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, wrapperClassName, label, error, hint, id, placeholder, rows = 4, ...props }, ref) => {
    const autoId = React.useId();
    const textareaId = id ?? autoId;
    const messageId = `${textareaId}-message`;
    const message = error ?? hint;

    return (
      <div className={cn('flex flex-col gap-1.5', wrapperClassName)}>
        <div className="relative">
          <textarea
            ref={ref}
            id={textareaId}
            rows={rows}
            placeholder={placeholder ?? ' '}
            aria-invalid={error ? true : undefined}
            aria-describedby={message ? messageId : undefined}
            className={cn(
              'peer w-full resize-y rounded-sm border border-input bg-surface px-4 pb-3 pt-6',
              'text-sm leading-relaxed text-foreground placeholder-transparent shadow-sm',
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
            htmlFor={textareaId}
            className={cn(
              'pointer-events-none absolute start-4 top-4',
              'text-sm text-muted transition-all duration-fast ease-out',
              'peer-focus:top-2 peer-focus:text-2xs peer-focus:font-semibold peer-focus:text-primary',
              'peer-[:not(:placeholder-shown)]:top-2 peer-[:not(:placeholder-shown)]:text-2xs peer-[:not(:placeholder-shown)]:font-semibold',
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
Textarea.displayName = 'Textarea';
