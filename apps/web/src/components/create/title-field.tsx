'use client';

import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * Champ titre « couverture » — l'utilisateur écrit en très grande typographie
 * display serif, comme s'il composait l'affiche de son cours. Textarea
 * auto-dimensionnée (pas de scrollbar), soulignée d'un filet dégradé qui
 * s'illumine au focus.
 */
export interface TitleFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Message d'erreur de validation (zod). */
  error?: string;
  /** Déclenché sur Entrée (sans Maj) — soumission rapide au clavier. */
  onEnter?: () => void;
}

const TITLE_MAX = 120;

export function TitleField({ value, onChange, error, onEnter }: TitleFieldProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const errorId = React.useId();

  // Auto-redimensionnement : la hauteur suit le contenu, jamais de scroll interne.
  React.useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <div className="group/title w-full">
      <textarea
        ref={textareaRef}
        rows={1}
        maxLength={TITLE_MAX}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            onEnter?.();
          }
        }}
        autoFocus
        aria-label="Titre du cours"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        placeholder="Ex. Maîtriser Docker en 7 jours"
        spellCheck={false}
        className={cn(
          'w-full resize-none overflow-hidden bg-transparent text-center',
          'font-display text-4xl font-semibold leading-tight text-foreground sm:text-5xl lg:text-6xl',
          'placeholder:text-muted/30 caret-accent-400',
          'focus:outline-none',
        )}
      />

      {/* Filet dégradé sous le titre — s'intensifie au focus */}
      <div
        aria-hidden="true"
        className={cn(
          'mx-auto mt-4 h-px w-2/3 max-w-md bg-gradient-to-r from-transparent via-border to-transparent',
          'transition-opacity duration-base ease-standard',
          'group-focus-within/title:via-accent-400/70',
        )}
      />

      <div className="mt-3 flex min-h-5 items-center justify-center gap-4">
        {error ? (
          <p id={errorId} role="alert" className="text-sm text-danger animate-fade-in">
            {error}
          </p>
        ) : (
          value.length > 0 && (
            <span className="text-2xs tabular-nums text-muted/70" aria-hidden="true">
              {value.length} / {TITLE_MAX}
            </span>
          )
        )}
      </div>
    </div>
  );
}
