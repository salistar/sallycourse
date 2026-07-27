'use client';

import * as React from 'react';

/**
 * Hook réutilisable d'enregistrement micro via MediaRecorder.
 *
 * Extrait de la logique historiquement inline dans `components/create/voice-dictation.tsx`
 * pour être partagé avec l'UI de clonage vocal (settings/voice). Il encapsule :
 *  - la garde de support navigateur (getUserMedia + MediaRecorder) ;
 *  - l'ouverture du flux micro, la collecte des chunks, l'assemblage d'un Blob `audio/webm` ;
 *  - un MINUTEUR (secondes écoulées) — la durée doit venir de ce timer, jamais de
 *    HTMLAudioElement.duration (les webm MediaRecorder renvoient souvent Infinity/NaN) ;
 *  - le nettoyage des pistes micro au démontage.
 *
 * Aucune dépendance au flux dictée/clone : le consommateur décide quoi faire du Blob.
 */

export type AudioRecorderStatus = 'idle' | 'recording';

export interface UseAudioRecorderResult {
  /** true si le navigateur supporte getUserMedia + MediaRecorder. */
  supported: boolean;
  status: AudioRecorderStatus;
  /** Secondes écoulées depuis `start()` (via minuteur, remis à 0 par `start`/`reset`). */
  elapsedSeconds: number;
  /** Ouvre le micro et démarre l'enregistrement. Rejette si micro refusé/indisponible. */
  start: () => Promise<void>;
  /** Arrête l'enregistrement et résout avec le Blob `audio/webm` capturé. */
  stop: () => Promise<Blob>;
  /** Annule l'enregistrement en cours, libère le micro et remet le minuteur à 0. */
  reset: () => void;
}

const MIME_TYPE = 'audio/webm';

export function useAudioRecorder(): UseAudioRecorderResult {
  const [status, setStatus] = React.useState<AudioRecorderStatus>('idle');
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0);
  const [supported, setSupported] = React.useState(false);

  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const streamRef = React.useRef<MediaStream | null>(null);
  const timerRef = React.useRef<number | null>(null);
  // Gardes anti-fuite de piste micro : re-entrée de start() et démontage pendant
  // l'await getUserMedia (le flux acquis après démontage/2e start est stoppé).
  const startingRef = React.useRef(false);
  const mountedRef = React.useRef(true);

  // Détection de support côté client uniquement (évite un mismatch SSR).
  React.useEffect(() => {
    setSupported(
      typeof navigator !== 'undefined' &&
        Boolean(navigator.mediaDevices?.getUserMedia) &&
        typeof window !== 'undefined' &&
        typeof window.MediaRecorder !== 'undefined',
    );
  }, []);

  const clearTimer = React.useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopStream = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Nettoyage au démontage : coupe minuteur et micro, et marque démonté (pour
  // qu'un getUserMedia résolu APRÈS le démontage ne retienne pas une piste).
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimer();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [clearTimer]);

  const start = React.useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('unsupported');
    }
    // Ré-entrée : un enregistrement (ou une ouverture en cours) est déjà là.
    if (startingRef.current || streamRef.current) return;
    startingRef.current = true;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } finally {
      startingRef.current = false;
    }
    // Démonté, ou un autre start a déjà ouvert un flux pendant l'await : on
    // stoppe immédiatement ce flux orphelin plutôt que de le retenir.
    if (!mountedRef.current || streamRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    streamRef.current = stream;
    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorderRef.current = recorder;
    recorder.start();
    setElapsedSeconds(0);
    setStatus('recording');
    clearTimer();
    timerRef.current = window.setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
  }, [clearTimer]);

  const stop = React.useCallback(
    () =>
      new Promise<Blob>((resolve, reject) => {
        const recorder = recorderRef.current;
        clearTimer();
        if (!recorder || recorder.state === 'inactive') {
          stopStream();
          setStatus('idle');
          reject(new Error('not recording'));
          return;
        }
        recorder.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: MIME_TYPE });
          chunksRef.current = [];
          stopStream();
          recorderRef.current = null;
          setStatus('idle');
          resolve(blob);
        };
        recorder.stop();
      }),
    [clearTimer, stopStream],
  );

  const reset = React.useCallback(() => {
    clearTimer();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null;
      recorder.stop();
    }
    recorderRef.current = null;
    chunksRef.current = [];
    stopStream();
    setElapsedSeconds(0);
    setStatus('idle');
  }, [clearTimer, stopStream]);

  return { supported, status, elapsedSeconds, start, stop, reset };
}
