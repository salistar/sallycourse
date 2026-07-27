'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Mic, RotateCcw, Square, Upload } from 'lucide-react';
import { Badge, Button, useToast } from '@/components/ui';
import { errorMessage } from '@/lib/error-message';
import { useAudioRecorder } from '@/hooks/use-audio-recorder';

/**
 * Audio manuel par slide (Lot 4, plan 2026-07-20) : l'auteur enregistre au
 * micro (hook `useAudioRecorder`, blob webm) ou uploade un fichier existant
 * pour remplacer la narration TTS d'UNE slide. Le fichier est normalisé côté
 * worker (loudnorm, comme le TTS) de façon asynchrone (polling), puis survit
 * à toute régénération de la leçon (`tts-generation.ts` copie l'enregistrement
 * au lieu de resynthétiser). Appliquer le résultat à la vidéo déjà rendue
 * reste une action séparée (bouton « Appliquer à la vidéo », comme pour
 * l'image de slide, Lot 3).
 */
export interface SlideAudioPanelProps {
  courseId: string;
  lessonId: string;
  index: number;
}

type AudioStatus = 'loading' | 'idle' | 'pending' | 'ready' | 'failed';

interface GetResponse {
  status?: AudioStatus;
  url?: string;
  source?: 'tts' | 'manual';
  seconds?: number | null;
}

const ENDPOINT = (courseId: string, lessonId: string, index: number): string =>
  `/api/courses/${courseId}/lessons/${lessonId}/slides/${index}/audio`;

const POLL_MS = 4000;
const ACCEPTED = 'audio/webm,audio/mp3,audio/mpeg,audio/wav,audio/x-wav,audio/wave';

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function SlideAudioPanel({ courseId, lessonId, index }: SlideAudioPanelProps) {
  const t = useTranslations('course.editor.video.audio');
  const tApiError = useTranslations('apiErrors');
  const { toast } = useToast();
  const recorder = useAudioRecorder();
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [status, setStatus] = React.useState<AudioStatus>('loading');
  const [url, setUrl] = React.useState<string | undefined>(undefined);
  const [source, setSource] = React.useState<'tts' | 'manual'>('tts');
  const [busy, setBusy] = React.useState(false);

  const applyGet = React.useCallback((data: GetResponse | null) => {
    setStatus(data?.status ?? 'idle');
    setUrl(data?.url);
    setSource(data?.source ?? 'tts');
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

  const upload = React.useCallback(
    async (blob: Blob, filename: string) => {
      setBusy(true);
      try {
        const form = new FormData();
        form.set('file', blob, filename);
        const res = await fetch(ENDPOINT(courseId, lessonId, index), { method: 'POST', body: form });
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
    },
    [courseId, lessonId, index, toast, t, tApiError],
  );

  const onStartRecording = React.useCallback(async () => {
    if (!recorder.supported) {
      toast({ title: t('micUnavailableTitle'), description: t('micUnavailableDescription'), variant: 'danger' });
      return;
    }
    try {
      await recorder.start();
    } catch {
      toast({ title: t('micDeniedTitle'), description: t('micDeniedDescription'), variant: 'warning' });
    }
  }, [recorder, toast, t]);

  const onUseRecording = React.useCallback(async () => {
    let blob: Blob;
    try {
      blob = await recorder.stop();
    } catch {
      return;
    }
    if (blob.size === 0) {
      toast({ title: t('emptyRecordingTitle'), description: t('emptyRecordingDescription'), variant: 'danger' });
      return;
    }
    await upload(blob, 'recording.webm');
  }, [recorder, toast, t, upload]);

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
      setSource('tts');
    } catch {
      toast({ title: t('networkErrorTitle'), description: t('networkErrorDescription'), variant: 'danger' });
    } finally {
      setBusy(false);
    }
  }, [courseId, lessonId, index, toast, t, tApiError]);

  const pending = status === 'pending';
  const recording = recorder.status === 'recording';

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-subtle p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-muted">
          <Mic className="size-3.5" aria-hidden="true" />
          {t('title')}
        </span>
        <div className="flex items-center gap-2">
          {source === 'manual' && !pending && <Badge variant="ready">{t('sourceManual')}</Badge>}
          {status === 'pending' && <Badge variant="generating">{t('statusPending')}</Badge>}
          {status === 'failed' && <Badge variant="failed">{t('statusFailed')}</Badge>}
        </div>
      </div>

      {url && (
        // Enregistrement manuel normalisé servi via URL S3 présignée, hors optimiseur Next.
        <audio controls src={url} className="h-9 w-full" />
      )}

      <div className="flex flex-wrap items-center gap-2">
        {recording ? (
          <>
            <span className="flex items-center gap-1.5 font-mono text-xs text-foreground" aria-live="polite">
              <span className="inline-block size-2 animate-pulse rounded-full bg-danger" aria-hidden="true" />
              {formatElapsed(recorder.elapsedSeconds)}
            </span>
            <Button variant="secondary" size="sm" onClick={() => void onUseRecording()}>
              <Square aria-hidden="true" />
              {t('useRecording')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => recorder.reset()}>
              {t('cancelRecording')}
            </Button>
          </>
        ) : (
          <>
            {recorder.supported && (
              <Button variant="secondary" size="sm" disabled={busy || pending} onClick={() => void onStartRecording()}>
                <Mic aria-hidden="true" />
                {t('recordMic')}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={busy || pending}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload aria-hidden="true" />
              {t('uploadFile')}
            </Button>
            {source === 'manual' && (
              <Button variant="ghost" size="sm" disabled={busy || pending} onClick={() => void reset()}>
                <RotateCcw aria-hidden="true" />
                {t('revertToTts')}
              </Button>
            )}
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void upload(file, file.name);
          }}
        />
      </div>
    </div>
  );
}
