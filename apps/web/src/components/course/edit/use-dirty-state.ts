'use client';

import * as React from 'react';

/**
 * Suivi du dirty-state d'un éditeur : compare la valeur courante à une
 * baseline et arme un garde-fou `beforeunload` tant que des modifications
 * ne sont pas sauvegardées. La baseline est réinitialisable après une
 * sauvegarde réussie.
 */
export function useDirtyState<T>(current: T, baseline: T) {
  // Sérialisation stable pour comparer des objets/tableaux par valeur.
  const dirty = React.useMemo(
    () => JSON.stringify(current) !== JSON.stringify(baseline),
    [current, baseline],
  );

  // Avertissement natif du navigateur avant de fermer/naviguer avec un
  // brouillon non sauvegardé (la string est ignorée par les navigateurs
  // modernes, mais preventDefault suffit à déclencher la confirmation).
  React.useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  return dirty;
}

/**
 * Confirmation avant d'abandonner des modifications non sauvegardées lors
 * d'une navigation interne (changement de leçon, sortie du mode édition).
 * Retourne true si l'on peut continuer.
 */
export function confirmDiscardIfDirty(dirty: boolean, message?: string): boolean {
  if (!dirty) return true;
  return window.confirm(
    message ?? 'Des modifications non sauvegardées seront perdues. Continuer ?',
  );
}
