'use client';

import * as React from 'react';

/**
 * Contexte des réglages du styleguide vivant : thème (light/dark appliqué
 * globalement via la classe `.dark` sur <html>), sens de lecture des zones
 * de démonstration (LTR/RTL) et grain photographique (on/off).
 */

export type ThemeMode = 'light' | 'dark';
export type TextDirection = 'ltr' | 'rtl';

export interface DesignSettings {
  theme: ThemeMode;
  dir: TextDirection;
  grain: boolean;
  setTheme: (theme: ThemeMode) => void;
  setDir: (dir: TextDirection) => void;
  setGrain: (grain: boolean) => void;
}

const DesignSettingsContext = React.createContext<DesignSettings | null>(null);

/** Accès aux réglages — à utiliser sous <DesignSettingsProvider>. */
export function useDesignSettings(): DesignSettings {
  const context = React.useContext(DesignSettingsContext);
  if (!context) {
    throw new Error('useDesignSettings doit être appelé sous <DesignSettingsProvider>');
  }
  return context;
}

export function DesignSettingsProvider({ children }: { children: React.ReactNode }) {
  // Le dark est le thème par défaut de SallyCourse (classe posée dans layout.tsx).
  const [theme, setTheme] = React.useState<ThemeMode>('dark');
  const [dir, setDir] = React.useState<TextDirection>('ltr');
  const [grain, setGrain] = React.useState(true);

  // Bascule light/dark RÉELLE : on pilote la classe `.dark` de <html>,
  // exactement comme le fera le futur sélecteur de thème du produit.
  React.useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    // À la sortie de la page, on restaure le thème par défaut du produit.
    return () => {
      root.classList.add('dark');
    };
  }, [theme]);

  const value = React.useMemo<DesignSettings>(
    () => ({ theme, dir, grain, setTheme, setDir, setGrain }),
    [theme, dir, grain],
  );

  return <DesignSettingsContext.Provider value={value}>{children}</DesignSettingsContext.Provider>;
}
