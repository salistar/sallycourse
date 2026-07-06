'use client';

import { useEffect, useRef, useState } from 'react';

// Hook client de suivi de génération : consomme le flux SSE
// /api/courses/[id]/progress avec reconnexion automatique (backoff 1 s → 10 s).

/** Ligne de log normalisée côté client. */
export interface ProgressLog {
  ts: number;
  level: 'info' | 'warn' | 'error';
  msg: string;
}

export interface CourseProgressState {
  /** Étape courante du pipeline (null tant qu'aucun événement reçu). */
  step: string | null;
  /** Avancement 0–100 de l'étape courante. */
  progress: number;
  logs: ProgressLog[];
  /** Vrai quand le flux SSE est ouvert. */
  connected: boolean;
}

const INITIAL_STATE: CourseProgressState = {
  step: null,
  progress: 0,
  logs: [],
  connected: false,
};

const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MAX_MS = 10_000;
/** Borne le journal pour éviter une croissance mémoire infinie. */
const MAX_LOGS = 500;

/** Payload SSE : snapshot initial (logs[]) ou ProgressEvent relayé (message). */
interface ProgressPayload {
  step?: string;
  progress?: number;
  message?: string;
  level?: ProgressLog['level'];
  logs?: ProgressLog[];
  ts?: number;
}

export function useCourseProgress(courseId: string | null): CourseProgressState {
  const [state, setState] = useState<CourseProgressState>(INITIAL_STATE);
  const sourceRef = useRef<EventSource | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(BACKOFF_INITIAL_MS);
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;
    setState(INITIAL_STATE);
    if (!courseId) return;

    const connect = (): void => {
      if (unmountedRef.current) return;

      const source = new EventSource(`/api/courses/${encodeURIComponent(courseId)}/progress`);
      sourceRef.current = source;

      source.onopen = () => {
        backoffRef.current = BACKOFF_INITIAL_MS;
        setState((prev) => ({ ...prev, connected: true }));
      };

      source.onmessage = (event: MessageEvent<string>) => {
        let payload: ProgressPayload;
        try {
          payload = JSON.parse(event.data) as ProgressPayload;
        } catch {
          return; // Payload non-JSON : ignoré.
        }

        setState((prev) => {
          let logs = prev.logs;
          if (Array.isArray(payload.logs)) {
            // Snapshot initial : le journal complet remplace l'état local.
            logs = payload.logs.slice(-MAX_LOGS);
          } else if (payload.message) {
            logs = [
              ...prev.logs,
              {
                ts: payload.ts ?? Date.now(),
                level: payload.level ?? 'info',
                msg: payload.message,
              },
            ].slice(-MAX_LOGS);
          }
          return {
            connected: true,
            step: payload.step ?? prev.step,
            progress: typeof payload.progress === 'number' ? payload.progress : prev.progress,
            logs,
          };
        });
      };

      source.onerror = () => {
        // On gère nous-mêmes la reconnexion pour contrôler le backoff.
        source.close();
        if (sourceRef.current === source) sourceRef.current = null;
        setState((prev) => (prev.connected ? { ...prev, connected: false } : prev));
        if (unmountedRef.current) return;
        const delay = backoffRef.current;
        backoffRef.current = Math.min(delay * 2, BACKOFF_MAX_MS);
        retryTimerRef.current = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      unmountedRef.current = true;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
      sourceRef.current?.close();
      sourceRef.current = null;
      backoffRef.current = BACKOFF_INITIAL_MS;
    };
  }, [courseId]);

  return state;
}
