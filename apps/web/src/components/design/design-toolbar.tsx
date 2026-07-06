'use client';

import * as React from 'react';
import { Film, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  useDesignSettings,
  type TextDirection,
  type ThemeMode,
} from './design-context';

/**
 * Barre de contrôle flottante du styleguide — verre dépoli sur liseré
 * dégradé violet → or. Trois réglages : thème, sens de lecture, grain.
 */

interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  srLabel: string;
}

/** Petit contrôle segmenté accessible (groupe de boutons pressables). */
function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: Array<SegmentedOption<T>>;
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-0.5 rounded-full bg-surface-subtle/60 p-0.5">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            aria-label={option.srLabel}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-full px-2.5 text-xs font-semibold',
              'transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80',
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Séparateur vertical discret entre groupes de contrôles. */
function Divider() {
  return <span aria-hidden="true" className="h-5 w-px bg-border/80" />;
}

export function DesignToolbar() {
  const { theme, setTheme, dir, setDir, grain, setGrain } = useDesignSettings();

  return (
    <div className="sticky top-4 z-40 flex justify-center px-4">
      {/* Liseré dégradé 1px — la signature SALISTAR, jamais en aplat */}
      <div className="rounded-full bg-gradient-to-r from-primary-500/50 via-border to-accent-400/50 p-px shadow-lg">
        {/* Verre dépoli discret sur surface élevée */}
        <div className="flex items-center gap-2 rounded-full bg-surface/75 px-2.5 py-1.5 backdrop-blur-xl sm:gap-3">
          <Segmented<ThemeMode>
            label="Thème"
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'light', srLabel: 'Thème clair', label: <Sun className="h-4 w-4" aria-hidden="true" /> },
              { value: 'dark', srLabel: 'Thème sombre', label: <Moon className="h-4 w-4" aria-hidden="true" /> },
            ]}
          />
          <Divider />
          <Segmented<TextDirection>
            label="Sens de lecture des démonstrations"
            value={dir}
            onChange={setDir}
            options={[
              { value: 'ltr', srLabel: 'Gauche vers droite (FR/EN)', label: 'LTR' },
              { value: 'rtl', srLabel: 'Droite vers gauche (AR)', label: 'RTL' },
            ]}
          />
          <Divider />
          <button
            type="button"
            aria-pressed={grain}
            onClick={() => setGrain(!grain)}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold',
              'transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80',
              grain ? 'bg-primary-soft text-foreground' : 'text-muted hover:text-foreground',
            )}
          >
            <Film className="h-4 w-4" aria-hidden="true" />
            Grain
          </button>
        </div>
      </div>
    </div>
  );
}
