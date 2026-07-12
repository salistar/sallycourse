'use client';

import * as React from 'react';
import { HardDriveDownload } from 'lucide-react';
import { Button, buttonVariants, useToast } from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * « Exporter en mode portable » (Prompt 142) — même mécanique que
 * DownloadPackButton (enfile POST puis sonde GET jusqu'à disponibilité) mais
 * cible /portable-export : mini-site HTML/CSS/JS autonome utilisable hors
 * ligne depuis une clé USB (aucun serveur requis, protocole file://).
 */
export interface DownloadPortableButtonProps {
  courseId: string;
}

/** Intervalle de polling du statut de l'export (ms). */
const POLL_INTERVAL_MS = 3_000;
/** Nombre maximal de sondages avant abandon (~2 min à 3 s). */
const MAX_POLLS = 40;

type PortableState =
  | { phase: 'idle' }
  | { phase: 'building' }
  | { phase: 'ready'; url: string };

export function DownloadPortableButton({ courseId }: DownloadPortableButtonProps) {
  const { toast } = useToast();
  const [state, setState] = React.useState<PortableState>({ phase: 'idle' });
  const pollTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollsLeft = React.useRef(0);

  const clearTimer = React.useCallback(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  // Vérifie une fois au montage si un export portable est déjà disponible.
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/courses/${courseId}/portable-export`, { method: 'GET' });
        if (!cancelled && res.ok) {
          const data = (await res.json().catch(() => null)) as { ready?: boolean; url?: string } | null;
          if (data?.ready && data.url) setState({ phase: 'ready', url: data.url });
        }
      } catch {
        // Pas d'export (ou réseau indisponible) : on reste à l'état initial.
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
        title: 'Export trop long',
        description: 'La construction du site portable prend plus de temps que prévu, réessayez.',
        variant: 'danger',
      });
      return;
    }
    pollsLeft.current -= 1;
    try {
      const res = await fetch(`/api/courses/${courseId}/portable-export`, { method: 'GET' });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as { ready?: boolean; url?: string } | null;
        if (data?.ready && data.url) {
          setState({ phase: 'ready', url: data.url });
          toast({ title: 'Export portable prêt', description: 'Le téléchargement est disponible.', variant: 'success' });
          return;
        }
      }
    } catch {
      // Erreur transitoire : on retente jusqu'à épuisement du budget.
    }
    pollTimer.current = setTimeout(() => void poll(), POLL_INTERVAL_MS);
  }, [courseId, toast]);

  /** Lance l'export portable (POST) puis démarre le polling. */
  const build = React.useCallback(async () => {
    setState({ phase: 'building' });
    pollsLeft.current = MAX_POLLS;
    try {
      const res = await fetch(`/api/courses/${courseId}/portable-export`, { method: 'POST' });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setState({ phase: 'idle' });
        toast({
          title: 'Export impossible',
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
        <HardDriveDownload aria-hidden="true" />
        Télécharger (mode portable)
      </a>
    );
  }

  const building = state.phase === 'building';
  return (
    <Button variant="secondary" size="sm" loading={building} onClick={build}>
      {!building && <HardDriveDownload aria-hidden="true" />}
      {building ? 'Construction…' : 'Exporter en mode portable'}
    </Button>
  );
}
