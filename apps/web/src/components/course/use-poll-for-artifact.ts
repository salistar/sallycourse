'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/ui';
import { errorMessage } from '@/lib/error-message';

/**
 * Mécanique commune aux boutons de téléchargement d'artefacts asynchrones
 * (archive maître, SCORM, pack, export portable, rapport de déploiement) :
 *
 *   1. Au montage, GET l'endpoint : si l'artefact existe déjà → état `ready`.
 *   2. Sur `build()`, POST pour enfiler la construction, puis sonde en GET
 *      toutes les 3 s jusqu'à `{ ready, url }` (ou abandon après `maxPolls`).
 *
 * Chaque bouton ne fournit que son `path`, son sous-espace i18n `sub`
 * (`course.download.<sub>.*`) et éventuellement son budget de sondages. Les
 * toasts succès/timeout/erreur/réseau sont émis ici de façon uniforme.
 */
const POLL_INTERVAL_MS = 3_000;
/** Budget de sondages par défaut (~2 min à 3 s). */
const DEFAULT_MAX_POLLS = 40;

type ArtifactState = { phase: 'idle' } | { phase: 'building' } | { phase: 'ready'; url: string };

export interface UsePollForArtifactOptions {
  courseId: string;
  /** Chemin sous `/api/courses/[id]/` (ex. `master-archive`, `deployments/report`). */
  path: string;
  /** Sous-espace i18n sous `course.download` (ex. `master`, `scorm`, `report`). */
  sub: string;
  /** Budget de sondages avant abandon (défaut 40). */
  maxPolls?: number;
}

export interface UsePollForArtifactResult {
  phase: ArtifactState['phase'];
  /** URL de téléchargement présignée une fois l'artefact prêt, sinon `null`. */
  url: string | null;
  building: boolean;
  build: () => void;
}

export function usePollForArtifact({
  courseId,
  path,
  sub,
  maxPolls = DEFAULT_MAX_POLLS,
}: UsePollForArtifactOptions): UsePollForArtifactResult {
  const { toast } = useToast();
  const t = useTranslations('course.download');
  const tApiError = useTranslations('apiErrors');
  const [state, setState] = React.useState<ArtifactState>({ phase: 'idle' });
  const pollTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollsLeft = React.useRef(0);
  const endpoint = `/api/courses/${courseId}/${path}`;

  const clearTimer = React.useCallback(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  // Vérifie une fois au montage si l'artefact est déjà disponible.
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(endpoint, { method: 'GET' });
        if (!cancelled && res.ok) {
          const data = (await res.json().catch(() => null)) as { ready?: boolean; url?: string } | null;
          if (data?.ready && data.url) setState({ phase: 'ready', url: data.url });
        }
      } catch {
        // Pas d'artefact (ou réseau indisponible) : on reste à l'état initial.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  React.useEffect(() => clearTimer, [clearTimer]);

  /** Sonde le statut jusqu'à ready, puis bascule en lien téléchargeable. */
  const poll = React.useCallback(async () => {
    if (pollsLeft.current <= 0) {
      setState({ phase: 'idle' });
      toast({ title: t(`${sub}.timeoutTitle`), description: t(`${sub}.timeoutDesc`), variant: 'danger' });
      return;
    }
    pollsLeft.current -= 1;
    try {
      const res = await fetch(endpoint, { method: 'GET' });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as { ready?: boolean; url?: string } | null;
        if (data?.ready && data.url) {
          setState({ phase: 'ready', url: data.url });
          toast({ title: t(`${sub}.readyTitle`), description: t('readyDesc'), variant: 'success' });
          return;
        }
      }
    } catch {
      // Erreur transitoire : on retente jusqu'à épuisement du budget.
    }
    pollTimer.current = setTimeout(() => void poll(), POLL_INTERVAL_MS);
  }, [endpoint, sub, t, toast]);

  /** Lance la construction (POST) puis démarre le polling. */
  const build = React.useCallback(async () => {
    setState({ phase: 'building' });
    pollsLeft.current = maxPolls;
    try {
      const res = await fetch(endpoint, { method: 'POST' });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
        setState({ phase: 'idle' });
        toast({ title: t(`${sub}.errorTitle`), description: errorMessage(data, tApiError), variant: 'danger' });
        return;
      }
      pollTimer.current = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    } catch {
      setState({ phase: 'idle' });
      toast({ title: t('networkErrorTitle'), description: t('networkErrorDesc'), variant: 'danger' });
    }
  }, [endpoint, maxPolls, poll, sub, t, tApiError, toast]);

  return {
    phase: state.phase,
    url: state.phase === 'ready' ? state.url : null,
    building: state.phase === 'building',
    build: () => void build(),
  };
}
