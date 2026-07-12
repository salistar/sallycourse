'use client';

import * as React from 'react';

/**
 * Sauvegarde automatique générique (P131) — débounce la valeur courante et
 * appelle `saveFn` après `delayMs` d'inactivité. Fournit un statut affichable
 * ('idle' | 'saving' | 'saved' | 'error') et l'horodatage de la dernière
 * sauvegarde réussie, pour un indicateur du type « Enregistré à 14:32 » /
 * « Enregistrement… ».
 *
 * Ne déclenche jamais sur le montage initial (seulement après un changement
 * réel de `value` par rapport à la valeur précédente) : évite un save
 * immédiat sur des données qui viennent d'être chargées.
 *
 * La logique de débounce/scheduling est isolée dans `createAutosaveScheduler`
 * (aucune dépendance React) pour rester testable avec les fake timers de
 * vitest sans avoir besoin de rendre un composant.
 */

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface UseAutosaveOptions {
  /** Délai de débounce en millisecondes (défaut 5000). */
  delayMs?: number;
  /** Désactive l'autosave (ex. pendant une sauvegarde manuelle en cours). */
  enabled?: boolean;
}

export interface UseAutosaveResult {
  status: AutosaveStatus;
  /** Date de la dernière sauvegarde automatique réussie (null si aucune). */
  lastSavedAt: Date | null;
}

export interface AutosaveSchedulerCallbacks<T> {
  saveFn: (value: T) => Promise<void> | void;
  onSaving: () => void;
  onSaved: () => void;
  onError: () => void;
}

export interface AutosaveScheduler<T> {
  /** Programme (ou reprogramme) une sauvegarde après `delayMs`. */
  schedule: (value: T) => void;
  /** Annule un déclenchement en attente (ex. démontage du composant). */
  cancel: () => void;
}

/**
 * Fabrique un ordonnanceur de débounce pur : chaque appel à `schedule`
 * annule le timer précédent et en programme un nouveau. Un jeton de course
 * (`runId`) garantit qu'une sauvegarde obsolète (annulée puis remplacée)
 * n'écrase pas le statut d'une sauvegarde plus récente si sa promesse se
 * résout après coup.
 */
export function createAutosaveScheduler<T>(
  delayMs: number,
  callbacks: AutosaveSchedulerCallbacks<T>,
): AutosaveScheduler<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let runId = 0;

  const schedule = (value: T) => {
    if (timer) clearTimeout(timer);
    const thisRun = ++runId;
    timer = setTimeout(() => {
      callbacks.onSaving();
      Promise.resolve(callbacks.saveFn(value))
        .then(() => {
          if (runId !== thisRun) return; // Un schedule plus récent a déjà pris le relais.
          callbacks.onSaved();
        })
        .catch(() => {
          if (runId !== thisRun) return;
          callbacks.onError();
        });
    }, delayMs);
  };

  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  return { schedule, cancel };
}

export function useAutosave<T>(
  value: T,
  saveFn: (value: T) => Promise<void> | void,
  options: UseAutosaveOptions = {},
): UseAutosaveResult {
  const { delayMs = 5000, enabled = true } = options;

  const [status, setStatus] = React.useState<AutosaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = React.useState<Date | null>(null);

  const isFirstRun = React.useRef(true);
  const saveFnRef = React.useRef(saveFn);
  saveFnRef.current = saveFn;

  const schedulerRef = React.useRef<AutosaveScheduler<T> | null>(null);
  if (!schedulerRef.current) {
    schedulerRef.current = createAutosaveScheduler<T>(delayMs, {
      saveFn: (v) => saveFnRef.current(v),
      onSaving: () => setStatus('saving'),
      onSaved: () => {
        setStatus('saved');
        setLastSavedAt(new Date());
      },
      onError: () => setStatus('error'),
    });
  }

  React.useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    if (!enabled) return;
    schedulerRef.current?.schedule(value);
  }, [value, delayMs, enabled]);

  React.useEffect(() => () => schedulerRef.current?.cancel(), []);

  return { status, lastSavedAt };
}

/** Libellé français court pour l'indicateur d'autosave. */
export function autosaveStatusLabel(status: AutosaveStatus, lastSavedAt: Date | null): string {
  if (status === 'saving') return 'Enregistrement…';
  if (status === 'error') return 'Échec de l’enregistrement automatique';
  if (status === 'saved' && lastSavedAt) {
    const hh = String(lastSavedAt.getHours()).padStart(2, '0');
    const mm = String(lastSavedAt.getMinutes()).padStart(2, '0');
    return `Enregistré à ${hh}:${mm}`;
  }
  return '';
}
