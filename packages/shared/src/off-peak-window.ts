// Fenêtre creuse de génération (P134) — option « Programmer cette nuit » :
// l'utilisateur coche une case pour que le job outline soit enfilé avec un
// délai BullMQ (opts.delay) jusqu'à la prochaine fenêtre creuse (2h-6h,
// heure locale du serveur). Calcul PUR (aucune I/O) pour rester testable et
// réutilisable côté web (enqueue) et côté UI (libellé « programmé pour… »).

/** Heure de début (incluse) de la fenêtre creuse, 0-23. */
export const OFF_PEAK_START_HOUR = 2;
/** Heure de fin (exclue) de la fenêtre creuse, 0-23. */
export const OFF_PEAK_END_HOUR = 6;

/**
 * Calcule le prochain instant (Date) appartenant à la fenêtre creuse
 * [OFF_PEAK_START_HOUR, OFF_PEAK_END_HOUR) à partir de `now` :
 *   - si `now` est déjà dans la fenêtre → renvoie `now` tel quel (démarrage immédiat) ;
 *   - si `now` est avant la fenêtre du jour → renvoie la fenêtre du jour à OFF_PEAK_START_HOUR ;
 *   - sinon (après la fenêtre du jour) → renvoie la fenêtre du lendemain à OFF_PEAK_START_HOUR.
 * Minutes/secondes/ms mis à zéro pour un horaire rond et déterministe.
 */
export function computeNextOffPeakStart(now: Date): Date {
  const hour = now.getHours();
  const start = new Date(now);
  start.setMinutes(0, 0, 0);

  if (hour >= OFF_PEAK_START_HOUR && hour < OFF_PEAK_END_HOUR) {
    // Déjà dans la fenêtre : démarrage immédiat (pas de délai artificiel).
    return new Date(now);
  }

  if (hour < OFF_PEAK_START_HOUR) {
    start.setHours(OFF_PEAK_START_HOUR);
    return start;
  }

  // Après la fenêtre du jour (hour >= OFF_PEAK_END_HOUR) : demain.
  start.setDate(start.getDate() + 1);
  start.setHours(OFF_PEAK_START_HOUR);
  return start;
}

/**
 * Délai (ms, >= 0) avant la prochaine fenêtre creuse — valeur directement
 * utilisable comme `opts.delay` BullMQ. 0 si déjà dans la fenêtre.
 */
export function computeNextOffPeakDelayMs(now: Date): number {
  const next = computeNextOffPeakStart(now);
  return Math.max(0, next.getTime() - now.getTime());
}
