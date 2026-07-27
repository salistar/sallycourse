'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeftRight, ImageOff, RefreshCw, Trash2, Upload } from 'lucide-react';
import { Badge, Button, useToast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/error-message';

/**
 * Illustration par slide (Lot 3, plan 2026-07-20) : régénération SDXL à la
 * demande (asynchrone, file d'attente dédiée) ou remplacement manuel (upload
 * synchrone). N'agit QUE sur la slide stockée (S3 + Lesson.script) — appliquer
 * le résultat à la vidéo déjà rendue reste une action séparée et volontaire
 * (bouton « Appliquer à la vidéo » → regenerate mode 'render-only'), pour que
 * l'auteur puisse ajuster plusieurs slides avant de payer un seul re-rendu.
 */
export interface SlideImagePanelProps {
  courseId: string;
  lessonId: string;
  index: number;
}

type ImageStatus = 'loading' | 'idle' | 'pending' | 'ready' | 'failed';
type ImageEngine = 'sdxl' | 'zimage';

interface GetResponse {
  status?: ImageStatus;
  url?: string;
  prompt?: string;
  source?: 'generated' | 'uploaded' | null;
  engine?: ImageEngine;
}

const ENDPOINT = (courseId: string, lessonId: string, index: number): string =>
  `/api/courses/${courseId}/lessons/${lessonId}/slides/${index}/image`;

const POLL_MS = 4000;
const ACCEPTED = 'image/png,image/jpeg,image/webp';

export function SlideImagePanel({ courseId, lessonId, index }: SlideImagePanelProps) {
  const t = useTranslations('course.editor.video.image');
  const tApiError = useTranslations('apiErrors');
  const { toast } = useToast();
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [status, setStatus] = React.useState<ImageStatus>('loading');
  const [url, setUrl] = React.useState<string | undefined>(undefined);
  const [prompt, setPrompt] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [switching, setSwitching] = React.useState(false);
  const [engine, setEngine] = React.useState<ImageEngine>('sdxl');

  const applyGet = React.useCallback((data: GetResponse | null) => {
    setStatus(data?.status ?? 'idle');
    setUrl(data?.url);
    setPrompt((prev) => (data?.prompt ? data.prompt : prev));
    setEngine(data?.engine ?? 'sdxl');
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(ENDPOINT(courseId, lessonId, index), { method: 'GET' });
        const data = (await res.json().catch(() => null)) as GetResponse | null;
        if (!cancelled) applyGet(data);
      } catch {
        if (!cancelled) setStatus('idle');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId, lessonId, index, applyGet]);

  React.useEffect(() => {
    if (status !== 'pending') return;
    let cancelled = false;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const res = await fetch(ENDPOINT(courseId, lessonId, index), { method: 'GET' });
          const data = (await res.json().catch(() => null)) as GetResponse | null;
          if (!cancelled) applyGet(data);
        } catch {
          /* réseau instable : on retentera au prochain tick */
        }
      })();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [status, courseId, lessonId, index, applyGet]);

  const regenerate = React.useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(ENDPOINT(courseId, lessonId, index), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(prompt.trim() ? { prompt: prompt.trim() } : {}),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({ title: t('failedTitle'), description: errorMessage(data, tApiError), variant: 'danger' });
        return;
      }
      setStatus('pending');
      toast({ title: t('startedTitle'), description: t('startedDescription'), variant: 'success' });
    } catch {
      toast({ title: t('networkErrorTitle'), description: t('networkErrorDescription'), variant: 'danger' });
    } finally {
      setBusy(false);
    }
  }, [courseId, lessonId, index, prompt, toast, t, tApiError]);

  const otherEngine: ImageEngine = engine === 'zimage' ? 'sdxl' : 'zimage';

  const switchEngine = React.useCallback(async () => {
    setSwitching(true);
    try {
      const res = await fetch(ENDPOINT(courseId, lessonId, index), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...(prompt.trim() ? { prompt: prompt.trim() } : {}), targetEngine: otherEngine }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({ title: t('failedTitle'), description: errorMessage(data, tApiError), variant: 'danger' });
        return;
      }
      setStatus('pending');
      toast({
        title: t('switchStartedTitle'),
        description: t('switchStartedDescription', { engine: t(`engine.${otherEngine}`) }),
        variant: 'success',
      });
    } catch {
      toast({ title: t('networkErrorTitle'), description: t('networkErrorDescription'), variant: 'danger' });
    } finally {
      setSwitching(false);
    }
  }, [courseId, lessonId, index, prompt, otherEngine, toast, t, tApiError]);

  const upload = React.useCallback(
    async (file: File) => {
      setBusy(true);
      try {
        const form = new FormData();
        form.set('file', file);
        const res = await fetch(ENDPOINT(courseId, lessonId, index), { method: 'POST', body: form });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          toast({ title: t('failedTitle'), description: errorMessage(data, tApiError), variant: 'danger' });
          return;
        }
        const refreshed = await fetch(ENDPOINT(courseId, lessonId, index), { method: 'GET' });
        const data = (await refreshed.json().catch(() => null)) as GetResponse | null;
        applyGet(data);
        toast({ title: t('uploadedTitle'), description: t('uploadedDescription'), variant: 'success' });
      } catch {
        toast({ title: t('networkErrorTitle'), description: t('networkErrorDescription'), variant: 'danger' });
      } finally {
        setBusy(false);
      }
    },
    [courseId, lessonId, index, applyGet, toast, t, tApiError],
  );

  const reset = React.useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(ENDPOINT(courseId, lessonId, index), { method: 'DELETE' });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({ title: t('failedTitle'), description: errorMessage(data, tApiError), variant: 'danger' });
        return;
      }
      setStatus('idle');
      setUrl(undefined);
    } catch {
      toast({ title: t('networkErrorTitle'), description: t('networkErrorDescription'), variant: 'danger' });
    } finally {
      setBusy(false);
    }
  }, [courseId, lessonId, index, toast, t, tApiError]);

  const pending = status === 'pending';

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-subtle p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-muted">
          {t('title')}
        </span>
        {status === 'pending' && <Badge variant="generating">{t('statusPending')}</Badge>}
        {status === 'failed' && <Badge variant="failed">{t('statusFailed')}</Badge>}
      </div>

      <div className="flex items-start gap-3">
        <div
          className={cn(
            'flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-md',
            'border border-border bg-surface',
          )}
        >
          {url ? (
            // Illustration SDXL/uploadée servie via URL S3 présignée, hors optimiseur Next.
            <img src={url} alt={t('previewAlt')} className="size-full object-cover" />
          ) : (
            <ImageOff className="size-6 text-muted" aria-hidden="true" />
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <input
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={t('promptPlaceholder')}
            disabled={busy || pending}
            className={cn(
              'w-full rounded-sm border border-input bg-surface px-2.5 py-1.5 text-xs text-foreground',
              'shadow-sm transition-colors duration-fast ease-standard',
              'hover:border-ring/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/35',
            )}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" loading={busy && !pending} disabled={pending || switching} onClick={regenerate}>
              <RefreshCw aria-hidden="true" />
              {pending ? t('statusPending') : t('regenerate')}
            </Button>
            {/* Bouton « essayer l'autre moteur » (audit qualité modèles
                2026-07-22, additif) — bascule CETTE slide vers l'autre moteur
                d'image (SDXL ⇄ Z-Image Turbo). */}
            <Button
              variant="ghost"
              size="sm"
              loading={switching}
              disabled={busy || pending}
              onClick={switchEngine}
            >
              <ArrowLeftRight aria-hidden="true" />
              {t('switchEngineButton', { engine: t(`engine.${otherEngine}`) })}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy || pending || switching}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload aria-hidden="true" />
              {t('replace')}
            </Button>
            {url && (
              <Button
                variant="ghost"
                size="sm"
                className="text-danger hover:bg-danger/10"
                disabled={busy || pending}
                onClick={reset}
              >
                <Trash2 aria-hidden="true" />
                {t('remove')}
              </Button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED}
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void upload(file);
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
