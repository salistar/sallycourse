// Fonctions PURES pour l'enregistrement micro d'un échantillon de voix.
// Utilisées par l'UI de clonage vocal (apps/web) : le minuteur d'enregistrement
// et la garde de durée minimale AVANT soumission. La durée vient du temps écoulé
// mesuré côté client (un TIMER), jamais de HTMLAudioElement.duration : les blobs
// webm de MediaRecorder renvoient très souvent Infinity/NaN, ce que la route
// /api/account/voice-clone rejette (elle exige durationSeconds fini > 0 et >= 60 s).

/** Durée minimale (s) d'un échantillon pour être accepté par la route de clonage. */
export const MIN_VOICE_SAMPLE_SECONDS = 60;

/**
 * Formate un nombre de secondes écoulées en « m:ss » pour l'affichage du minuteur.
 * Les valeurs négatives ou non finies sont ramenées à 0.
 */
export function formatRecordingTime(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Un enregistrement est soumettable uniquement s'il atteint la durée minimale.
 * @param elapsedSeconds temps écoulé mesuré par le minuteur d'enregistrement.
 * @param minSeconds durée minimale requise (défaut : {@link MIN_VOICE_SAMPLE_SECONDS}).
 */
export function canSubmitRecording(
  elapsedSeconds: number,
  minSeconds: number = MIN_VOICE_SAMPLE_SECONDS,
): boolean {
  return Number.isFinite(elapsedSeconds) && elapsedSeconds >= minSeconds;
}

/**
 * Secondes restantes avant d'atteindre la durée minimale (0 une fois atteinte).
 * Sert à afficher un message « encore Xs » pendant l'enregistrement.
 */
export function remainingSecondsBeforeSubmit(
  elapsedSeconds: number,
  minSeconds: number = MIN_VOICE_SAMPLE_SECONDS,
): number {
  const elapsed = Number.isFinite(elapsedSeconds) && elapsedSeconds > 0 ? elapsedSeconds : 0;
  return Math.max(0, Math.ceil(minSeconds - elapsed));
}
