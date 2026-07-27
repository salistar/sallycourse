'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

/**
 * Lecteur vidéo anti-piratage du LMS (Prompt 206). Pour un étudiant INSCRIT, il
 * demande à /watch une URL SIGNÉE à TTL COURT vers SA copie filigranée (rendue
 * paresseusement puis mise en cache). Tant que le filigrane est en cours de
 * rendu, /watch renvoie la vidéo NON filigranée : la lecture n'est jamais
 * bloquée. La vidéo n'est JAMAIS servie autrement que par /watch (qui vérifie
 * l'inscription) : la page ne fournit aucune URL brute de repli, sans quoi le
 * filigrane et le paywall seraient contournés.
 *
 * Un identifiant d'appareil stable (localStorage) accompagne chaque requête :
 * il alimente la détection de partage de compte côté serveur (max 2 appareils).
 */

const DEVICE_ID_KEY = 'sc_device_id';

/** Récupère (ou crée) un identifiant d'appareil stable et opaque. */
function getDeviceId(): string {
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `dev-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    window.localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    // localStorage indisponible (mode privé) : id éphémère par session.
    return `ephemeral-${Math.random().toString(36).slice(2)}`;
  }
}

export interface WatermarkedVideoProps {
  courseId: string;
  lessonId: string;
  captionsUrl?: string;
}

export function WatermarkedVideo({ courseId, lessonId, captionsUrl }: WatermarkedVideoProps) {
  const t = useTranslations('learn.video');
  const [src, setSrc] = React.useState<string | undefined>(undefined);
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setSrc(undefined);
    setPending(false);

    (async () => {
      try {
        const res = await fetch(`/api/lms/courses/${courseId}/lessons/${lessonId}/watch`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ deviceId: getDeviceId() }),
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { url?: string; pending?: boolean };
        if (cancelled || !data.url) return;
        setSrc(data.url);
        setPending(Boolean(data.pending));
      } catch {
        // Échec réseau : pas de vidéo (aucun repli brut, par conception).
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [courseId, lessonId]);

  if (!src) {
    return <p className="text-sm text-muted">{t('notAvailable')}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <video
        key={src}
        controls
        controlsList="nodownload"
        preload="metadata"
        className="aspect-video w-full rounded-md border border-border bg-black"
        crossOrigin="anonymous"
      >
        <source src={src} type="video/mp4" />
        {captionsUrl && <track kind="captions" src={captionsUrl} default label={t('captionsLabel')} />}
      </video>
      {pending && (
        <p className="text-xs text-muted">
          {t('preparingCopy')}
        </p>
      )}
    </div>
  );
}
