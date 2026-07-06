'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/cn';

/**
 * Onglets SALISTAR — soulignement dégradé violet → or qui GLISSE d'un onglet
 * à l'autre via `layoutId` Framer Motion (unique par instance grâce à
 * `useId`). Navigation clavier flèches / Home / End, RTL géré.
 */

interface TabsContextValue {
  value: string;
  setValue: (value: string) => void;
  baseId: string;
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabsContext(component: string): TabsContextValue {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error(`<${component}> doit être utilisé à l'intérieur de <Tabs>.`);
  return ctx;
}

export interface TabsProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  /** Valeur contrôlée de l'onglet actif. */
  value?: string;
  /** Onglet actif initial (mode non contrôlé). */
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}

export function Tabs({ value, defaultValue, onValueChange, className, children, ...props }: TabsProps) {
  const baseId = React.useId();
  const [internal, setInternal] = React.useState(defaultValue ?? '');
  const current = value ?? internal;

  const setValue = React.useCallback(
    (next: string) => {
      setInternal(next);
      onValueChange?.(next);
    },
    [onValueChange],
  );

  const ctx = React.useMemo(() => ({ value: current, setValue, baseId }), [current, setValue, baseId]);

  return (
    <TabsContext.Provider value={ctx}>
      <div className={cn('flex flex-col gap-4', className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export function TabsList({ className, onKeyDown, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  // Navigation clavier conforme au pattern WAI-ARIA « Tabs ».
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(event.key)) return;

    const list = event.currentTarget;
    const tabs = Array.from(list.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'));
    const currentIndex = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (tabs.length === 0) return;

    // En RTL, les flèches gauche/droite s'inversent.
    const rtl = list.closest('[dir="rtl"]') !== null;
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';

    let nextIndex = currentIndex;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else if (event.key === forward) nextIndex = (currentIndex + 1 + tabs.length) % tabs.length;
    else nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;

    event.preventDefault();
    tabs[nextIndex]?.focus();
    tabs[nextIndex]?.click();
  };

  return (
    <div
      role="tablist"
      onKeyDown={handleKeyDown}
      className={cn('flex items-center gap-1 border-b border-border', className)}
      {...props}
    />
  );
}

export interface TabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

export function TabsTrigger({ value, className, children, onClick, ...props }: TabsTriggerProps) {
  const ctx = useTabsContext('TabsTrigger');
  const active = ctx.value === value;

  return (
    <button
      type="button"
      role="tab"
      id={`${ctx.baseId}-tab-${value}`}
      aria-selected={active}
      aria-controls={`${ctx.baseId}-panel-${value}`}
      tabIndex={active ? 0 : -1}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) ctx.setValue(value);
      }}
      className={cn(
        'relative -mb-px px-4 py-2.5 text-sm font-medium',
        'transition-colors duration-fast ease-standard',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        active ? 'text-foreground' : 'text-muted hover:text-foreground',
        className,
      )}
      {...props}
    >
      {children}
      {active && (
        // Le soulignement partage un layoutId par instance : Framer Motion
        // anime son déplacement fluide d'un onglet à l'autre.
        <motion.span
          layoutId={`${ctx.baseId}-underline`}
          transition={{ type: 'spring', stiffness: 500, damping: 40 }}
          className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-primary-400 to-accent-400"
        />
      )}
    </button>
  );
}

export interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
}

export function TabsContent({ value, className, ...props }: TabsContentProps) {
  const ctx = useTabsContext('TabsContent');
  const active = ctx.value === value;
  if (!active) return null;

  return (
    <div
      role="tabpanel"
      id={`${ctx.baseId}-panel-${value}`}
      aria-labelledby={`${ctx.baseId}-tab-${value}`}
      tabIndex={0}
      className={cn('animate-fade-in focus-visible:outline-none', className)}
      {...props}
    />
  );
}
