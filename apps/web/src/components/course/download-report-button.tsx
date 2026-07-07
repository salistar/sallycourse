'use client';

import * as React from 'react';
import { FileText } from 'lucide-react';
import { Button, buttonVariants, useToast } from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * « Télécharger le rapport » (P50) — enfile la génération du rapport de
 * déploiement (POST) puis interroge le statut (GET) jusqu'à disponibilité du
 * PDF, avant de basculer en lien présigné. Au montage, une vérification
 * silencieuse propose directement le lien si un rapport existe déjà.
 */
export interface DownloadReportButtonProps {
  courseId: string;
}

/** Intervalle de polling du statut du rapport (ms). */
const POLL_INTERVAL_MS = 3_000;
/** Nombre maximal de sondages avant abandon (~1 min à 3 s). */
const MAX_POLLS = 20;

type ReportState =
  | { phase: 'idle' }
  | { phase: 'building' }
  | { phase: 'ready'; url: string };

const ENDPOINT = (courseId: string) => `/api/courses/${courseId}/deployments/report`;

export function DownloadReportButton({ courseId }: DownloadReportButtonProps) {
  const { toast } = useToast();
  const [state, setState] = React.useState<ReportState>({ phase: 'idle' });
  const pollTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollsLeft = React.useRef(0);

  const clearTimer = React.useCallback(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  // Vérifie une fois au montage si un rapport est déjà disponible (sans l'enfiler).
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(ENDPOINT(courseId), { method: 'GET' });
        if (!cancelled && res.ok) {
          const data = (await res.json().catch(() => null)) as { ready?: boolean; url?: string } | null;
          if (data?.ready && data.url) setState({ phase: 'ready', url: data.url });
        }
      } catch {
        // Pas de rapport (ou réseau indisponible) : on reste à l'état initial.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  React.useEffect(() => clearTimer, [clearTimer]);

  /** Sonde le statut jusqu'à ready, puis bascule le bouton en lien. */
  const poll = React.useCallback(async () => {
    if (pollsLeft.current <= 0) {
      setState({ phase: 'idle' });
      toast({
        title: 'Rapport trop long',
        description: 'La génération du rapport prend plus de temps que prévu, réessayez.',
        variant: 'danger',
      });
      return;
    }
    pollsLeft.current -= 1;
    try {
      const res = await fetch(ENDPOINT(courseId), { method: 'GET' });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as { ready?: boolean; url?: string } | null;
        if (data?.ready && data.url) {
          setState({ phase: 'ready', url: data.url });
          toast({ title: 'Rapport prêt', description: 'Le téléchargement est disponible.', variant: 'success' });
          return;
        }
      }
    } catch {
      // Erreur transitoire : on retente jusqu'à épuisement du budget.
    }
    pollTimer.current = setTimeout(() => void poll(), POLL_INTERVAL_MS);
  }, [courseId, toast]);

  /** Lance la génération (POST) puis démarre le polling. */
  const build = React.useCallback(async () => {
    setState({ phase: 'building' });
    pollsLeft.current = MAX_POLLS;
    try {
      const res = await fetch(ENDPOINT(courseId), { method: 'POST' });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setState({ phase: 'idle' });
        toast({
          title: 'Rapport impossible',
          description: data?.error ?? 'Une erreur est survenue, réessayez plus tard.',
          variant: 'danger',
        });
        return;
      }
      pollTimer.current = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    } catch {
      setState({ phase: 'idle' });
      toast({
        title: 'Erreur réseau',
        description: 'Impossible de joindre le serveur, vérifiez votre connexion.',
        variant: 'danger',
      });
    }
  }, [courseId, poll, toast]);

  if (state.phase === 'ready') {
    return (
      <a
        href={state.url}
        download
        className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}
      >
        <FileText aria-hidden="true" />
        Télécharger le rapport
      </a>
    );
  }

  const building = state.phase === 'building';
  return (
    <Button variant="secondary" size="sm" loading={building} onClick={build}>
      {!building && <FileText aria-hidden="true" />}
      {building ? 'Génération…' : 'Rapport de déploiement'}
    </Button>
  );
}
