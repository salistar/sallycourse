'use client';

import * as React from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Sélecteur de thème clair / sombre / système. Le thème clair était entièrement
 * construit (tokens + variables CSS) mais sans aucun interrupteur produit —
 * audit design. Persiste dans localStorage('theme') et applique/retire la
 * classe `.dark` sur <html> (voir le script anti-FOUC du RootLayout). En mode
 * 'system', suit prefers-color-scheme en direct.
 */
type ThemeChoice = 'light' | 'dark' | 'system';

const OPTIONS: { value: ThemeChoice; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'light', label: 'Clair', icon: Sun },
  { value: 'dark', label: 'Sombre', icon: Moon },
  { value: 'system', label: 'Système', icon: Monitor },
];

/** Applique concrètement le choix sur <html> (classe .dark). */
function applyTheme(choice: ThemeChoice): void {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = choice === 'dark' || (choice === 'system' && prefersDark);
  document.documentElement.classList.toggle('dark', dark);
}

export function ThemeToggle() {
  const [choice, setChoice] = React.useState<ThemeChoice>('dark');

  // Lecture initiale (après hydratation — évite le mismatch SSR).
  React.useEffect(() => {
    const stored = (localStorage.getItem('theme') as ThemeChoice | null) ?? 'dark';
    setChoice(stored);
  }, []);

  // En mode système : réagir aux changements de préférence de l'OS en direct.
  React.useEffect(() => {
    if (choice !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [choice]);

  const select = (value: ThemeChoice) => {
    setChoice(value);
    try {
      localStorage.setItem('theme', value);
    } catch {
      /* stockage indisponible : on applique quand même pour la session */
    }
    applyTheme(value);
  };

  return (
    <div
      role="radiogroup"
      aria-label="Thème de l’interface"
      className="flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5"
    >
      {OPTIONS.map((opt) => {
        const active = choice === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={opt.label}
            title={opt.label}
            onClick={() => select(opt.value)}
            className={cn(
              'flex h-7 flex-1 items-center justify-center rounded-sm transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80',
              active ? 'bg-primary-soft text-foreground' : 'text-muted hover:text-foreground',
            )}
          >
            <opt.icon className="size-4" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
