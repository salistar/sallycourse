'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Trash2, UploadCloud, Video } from 'lucide-react';
import { errorMessage } from '@/lib/error-message';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, useToast } from '@/components/ui';

/**
 * Upload de la vidéo d'intro webcam (~60 s) du mode « compliance maximale »
 * Udemy (Prompt 48). Sélection d'un MP4/MOV/WebM → POST multipart vers
 * /api/courses/[id]/intro-video, aperçu présigné, suppression possible.
 * Au montage, sonde l'état existant (GET).
 */
export interface IntroVideoUploadProps {
  courseId: string;
}

type IntroState =
  | { phase: 'loading' }
  | { phase: 'empty' }
  | { phase: 'uploading' }
  | { phase: 'ready'; url: string };

const ENDPOINT = (id: string): string => `/api/courses/${id}/intro-video`;

export function IntroVideoUpload({ courseId }: IntroVideoUploadProps) {
  const { toast } = useToast();
  const t = useTranslations('course.introVideo');
  const tApiError = useTranslations('apiErrors');
  const [state, setState] = React.useState<IntroState>({ phase: 'loading' });
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  // Sonde l'état initial (une intro est-elle déjà présente ?).
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(ENDPOINT(courseId), { method: 'GET' });
        const data = (await res.json().catch(() => null)) as
          | { hasIntro?: boolean; url?: string }
          | null;
        if (cancelled) return;
        if (data?.hasIntro && data.url) setState({ phase: 'ready', url: data.url });
        else setState({ phase: 'empty' });
      } catch {
        if (!cancelled) setState({ phase: 'empty' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const onPick = React.useCallback(
    async (file: File) => {
      setState({ phase: 'uploading' });
      const body = new FormData();
      body.append('file', file);
      try {
        const res = await fetch(ENDPOINT(courseId), { method: 'POST', body });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          setState({ phase: 'empty' });
          toast({
            title: t('uploadFailedTitle'),
            description: errorMessage(data, tApiError),
            variant: 'danger',
          });
          return;
        }
        // Récupère l'URL présignée pour l'aperçu.
        const check = await fetch(ENDPOINT(courseId), { method: 'GET' });
        const data = (await check.json().catch(() => null)) as { url?: string } | null;
        setState(data?.url ? { phase: 'ready', url: data.url } : { phase: 'empty' });
        toast({ title: t('savedTitle'), variant: 'success' });
      } catch {
        setState({ phase: 'empty' });
        toast({ title: t('networkErrorTitle'), description: t('networkErrorDescription'), variant: 'danger' });
      }
    },
    [courseId, toast],
  );

  const onRemove = React.useCallback(async () => {
    try {
      const res = await fetch(ENDPOINT(courseId), { method: 'DELETE' });
      if (res.ok) {
        setState({ phase: 'empty' });
        toast({ title: t('removedTitle'), variant: 'success' });
      } else {
        toast({ title: t('removeFailedTitle'), variant: 'danger' });
      }
    } catch {
      toast({ title: t('networkErrorTitle'), variant: 'danger' });
    }
  }, [courseId, toast]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Video aria-hidden="true" className="size-5" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.phase === 'ready' ? (
          <>
            <video
              src={state.url}
              controls
              className="w-full max-w-md rounded-lg border border-border"
            />
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>
                <UploadCloud aria-hidden="true" />
                {t('replace')}
              </Button>
              <Button variant="ghost" size="sm" onClick={onRemove}>
                <Trash2 aria-hidden="true" />
                {t('remove')}
              </Button>
            </div>
          </>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            loading={state.phase === 'uploading'}
            disabled={state.phase === 'loading'}
            onClick={() => inputRef.current?.click()}
          >
            {state.phase !== 'uploading' && <UploadCloud aria-hidden="true" />}
            {state.phase === 'uploading' ? t('uploading') : t('upload')}
          </Button>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onPick(file);
            e.target.value = '';
          }}
        />
      </CardContent>
    </Card>
  );
}
