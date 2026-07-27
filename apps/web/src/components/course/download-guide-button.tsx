'use client';

import * as React from 'react';
import { FileDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, buttonVariants, useToast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/error-message';

/**
 * « Générer le guide manuel » (Prompt 176) — même mécanique que
 * DownloadPortableButton (POST enfile un job packaging, GET sonde jusqu'à
 * disponibilité) mais ciblée /manual-guide avec une plateforme : produit un ZIP
 * d'aide au téléversement MANUEL (guide HTML interactif + PDF + articles/quiz +
 * blocs copier-coller) pour la plateforme donnée.
 */
export interface DownloadGuideButtonProps {
  courseId: string;
  /** Plateforme cible (id éligible au mode manuel : udemy/teachable/thinkific/internal). */
  platform: string;
  /** Libellé lisible de la plateforme (affichage). */
  platformLabel: string;
  /**
   * Guide de REPRISE (Prompt 179) : ne contient que les étapes RESTANTES depuis le
   * checkpoint du déploiement interrompu. Change l'endpoint (…?resume=1) et les
   * libellés. Défaut false = guide complet (P176).
   */
  resume?: boolean;
}

/** Intervalle de polling du statut du guide (ms). */
const POLL_INTERVAL_MS = 3_000;
/** Nombre maximal de sondages avant abandon (~2 min à 3 s). */
const MAX_POLLS = 40;

type GuideState =
  | { phase: 'idle' }
  | { phase: 'building' }
  | { phase: 'ready'; url: string };

export function DownloadGuideButton({
  courseId,
  platform,
  platformLabel,
  resume = false,
}: DownloadGuideButtonProps) {
  const { toast } = useToast();
  const t = useTranslations('course.download');
  const tApiError = useTranslations('apiErrors');
  const [state, setState] = React.useState<GuideState>({ phase: 'idle' });
  const pollTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollsLeft = React.useRef(0);

  const endpoint = `/api/courses/${courseId}/manual-guide`;
  const statusUrl = `${endpoint}?platform=${encodeURIComponent(platform)}${resume ? '&resume=1' : ''}`;
  // Libellés adaptés au guide de reprise (étapes restantes) vs guide complet.
  const readyLabel = resume
    ? t('guide.linkLabelResume', { platform: platformLabel })
    : t('guide.linkLabelComplete', { platform: platformLabel });
  const idleLabel = resume
    ? t('guide.idleLabelResume', { platform: platformLabel })
    : t('guide.idleLabelComplete', { platform: platformLabel });

  const clearTimer = React.useCallback(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  // Vérifie une fois au montage si un guide est déjà disponible (sans l'enfiler).
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(statusUrl, { method: 'GET' });
        if (!cancelled && res.ok) {
          const data = (await res.json().catch(() => null)) as { ready?: boolean; url?: string } | null;
          if (data?.ready && data.url) setState({ phase: 'ready', url: data.url });
        }
      } catch {
        // Pas de guide (ou réseau indisponible) : on reste à l'état initial.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [statusUrl]);

  React.useEffect(() => clearTimer, [clearTimer]);

  /** Sonde le statut jusqu'à ready, puis bascule le bouton en lien. */
  const poll = React.useCallback(async () => {
    if (pollsLeft.current <= 0) {
      setState({ phase: 'idle' });
      toast({
        title: t('guide.timeoutTitle'),
        description: t('guide.timeoutDesc'),
        variant: 'danger',
      });
      return;
    }
    pollsLeft.current -= 1;
    try {
      const res = await fetch(statusUrl, { method: 'GET' });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as { ready?: boolean; url?: string } | null;
        if (data?.ready && data.url) {
          setState({ phase: 'ready', url: data.url });
          toast({
            title: t('guide.readyTitle'),
            description: t('guide.readyDesc', { platform: platformLabel }),
            variant: 'success',
          });
          return;
        }
      }
    } catch {
      // Erreur transitoire : on retente jusqu'à épuisement du budget.
    }
    pollTimer.current = setTimeout(() => void poll(), POLL_INTERVAL_MS);
  }, [statusUrl, platformLabel, toast, t]);

  /** Lance la génération (POST) puis démarre le polling. */
  const build = React.useCallback(async () => {
    setState({ phase: 'building' });
    pollsLeft.current = MAX_POLLS;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, ...(resume ? { resume: true } : {}) }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setState({ phase: 'idle' });
        toast({
          title: t('guide.errorTitle'),
          description: errorMessage(data, tApiError),
          variant: 'danger',
        });
        return;
      }
      pollTimer.current = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    } catch {
      setState({ phase: 'idle' });
      toast({
        title: t('networkErrorTitle'),
        description: t('networkErrorDesc'),
        variant: 'danger',
      });
    }
  }, [endpoint, platform, resume, poll, toast, t]);

  if (state.phase === 'ready') {
    return (
      <a
        href={state.url}
        download
        className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}
      >
        <FileDown aria-hidden="true" />
        {readyLabel}
      </a>
    );
  }

  const building = state.phase === 'building';
  return (
    <Button variant="secondary" size="sm" loading={building} onClick={build}>
      {!building && <FileDown aria-hidden="true" />}
      {building ? t('guide.building') : idleLabel}
    </Button>
  );
}
