'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Mic, Square, Loader2 } from 'lucide-react';
// Sous-module direct (jamais le barrel : il tire node:crypto → casse le bundle client).
import { DICTATION_INPUT_LANGS, type DictationBrief, type DictationInputLang } from '@sallycourse/shared/voice-intent';
import { Button, useToast } from '@/components/ui';
import { useAudioRecorder } from '@/hooks/use-audio-recorder';
import { errorMessage } from '@/lib/error-message';

/**
 * Dictée vocale de création de cours (Prompt 210). L'utilisateur décrit son
 * cours à l'oral (français, arabe ou darija) ; on enregistre via MediaRecorder,
 * on POST l'audio puis on POLLE le worker (aucun streaming temps réel possible :
 * le worker n'expose pas d'HTTP). Au résultat, le brief pré-remplit le
 * formulaire de création via `onBrief` — l'auteur garde toujours le dernier mot.
 */

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120_000;

type Status = 'idle' | 'recording' | 'uploading' | 'processing' | 'ready' | 'error';

const LANG_LABELS: Record<DictationInputLang, string> = {
  fr: 'Français',
  darija: 'Darija (marocain)',
  ar: 'Arabe',
};

export function VoiceDictation({ onBrief }: { onBrief: (brief: DictationBrief) => void }) {
  const t = useTranslations('create.voice');
  const tApiError = useTranslations('apiErrors');
  const { toast } = useToast();
  const recorder = useAudioRecorder();
  const [status, setStatus] = React.useState<Status>('idle');
  const [inputLang, setInputLang] = React.useState<DictationInputLang>('fr');
  const [understood, setUnderstood] = React.useState<string | null>(null);

  const pollTimerRef = React.useRef<number | null>(null);

  // Nettoyage : coupe le polling si le composant est démonté (le micro est géré
  // par le hook useAudioRecorder, qui libère ses propres pistes au démontage).
  React.useEffect(
    () => () => {
      if (pollTimerRef.current !== null) window.clearTimeout(pollTimerRef.current);
    },
    [],
  );

  const pollUntilDone = React.useCallback(
    (id: string, startedAt: number) => {
      const tick = async () => {
        try {
          const res = await fetch(`/api/voice/dictation/${id}`);
          const data = (await res.json().catch(() => null)) as
            | { status?: string; brief?: DictationBrief | null; error?: string | null }
            | null;
          if (!res.ok || !data) throw new Error('poll failed');

          if (data.status === 'ready' && data.brief) {
            setStatus('ready');
            setUnderstood(data.brief.understood ?? null);
            onBrief(data.brief);
            toast({ title: t('readyToastTitle'), description: t('readyToastDesc'), variant: 'success' });
            return;
          }
          if (data.status === 'failed') {
            setStatus('error');
            toast({
              title: t('failedToastTitle'),
              description: errorMessage(data, tApiError),
              variant: 'danger',
            });
            return;
          }
          // pending / transcribing : on continue à poller jusqu'au timeout.
          if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
            setStatus('error');
            toast({ title: t('timeoutToastTitle'), description: t('timeoutToastDesc'), variant: 'warning' });
            return;
          }
          pollTimerRef.current = window.setTimeout(() => void tick(), POLL_INTERVAL_MS);
        } catch {
          setStatus('error');
          toast({ title: t('connectionLostToastTitle'), description: t('connectionLostToastDesc'), variant: 'danger' });
        }
      };
      pollTimerRef.current = window.setTimeout(() => void tick(), POLL_INTERVAL_MS);
    },
    [onBrief, toast, t, tApiError],
  );

  const uploadRecording = React.useCallback(async (blob: Blob) => {
    if (blob.size === 0) {
      setStatus('error');
      toast({ title: t('emptyToastTitle'), description: t('emptyToastDesc'), variant: 'danger' });
      return;
    }
    setStatus('uploading');
    try {
      const form = new FormData();
      form.append('file', blob, 'dictation.webm');
      form.append('inputLang', inputLang);
      const res = await fetch('/api/voice/dictation', { method: 'POST', body: form });
      const data = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!res.ok || !data?.id) {
        setStatus('error');
        toast({ title: t('uploadFailedToastTitle'), description: errorMessage(data, tApiError), variant: 'danger' });
        return;
      }
      setStatus('processing');
      pollUntilDone(data.id, Date.now());
    } catch {
      setStatus('error');
      toast({ title: t('connectionFailedToastTitle'), description: t('connectionFailedToastDesc'), variant: 'danger' });
    }
  }, [inputLang, pollUntilDone, toast, t, tApiError]);

  const startRecording = async () => {
    setUnderstood(null);
    if (!recorder.supported) {
      toast({ title: t('micUnavailableToastTitle'), description: t('micUnavailableToastDesc'), variant: 'danger' });
      return;
    }
    try {
      await recorder.start();
      setStatus('recording');
    } catch {
      toast({ title: t('micDeniedToastTitle'), description: t('micDeniedToastDesc'), variant: 'warning' });
    }
  };

  const stopRecording = () => {
    if (recorder.status !== 'recording') return;
    void recorder.stop().then((blob) => uploadRecording(blob));
  };

  const busy = status === 'uploading' || status === 'processing';

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-3 rounded-lg border border-input bg-surface/50 p-4">
      <div className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-widest text-muted">
        <Mic className="h-3.5 w-3.5" aria-hidden="true" /> {t('header')}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <label className="sr-only" htmlFor="dictation-lang">
          {t('langLabel')}
        </label>
        <select
          id="dictation-lang"
          value={inputLang}
          disabled={status === 'recording' || busy}
          onChange={(e) => setInputLang(e.target.value as DictationInputLang)}
          className="rounded-sm border border-input bg-surface px-2 py-1 text-xs text-foreground"
        >
          {DICTATION_INPUT_LANGS.map((lang) => (
            <option key={lang} value={lang}>
              {LANG_LABELS[lang]}
            </option>
          ))}
        </select>

        {status === 'recording' ? (
          <Button variant="danger" size="sm" onClick={stopRecording}>
            <Square className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> {t('stop')}
          </Button>
        ) : (
          <Button variant="secondary" size="sm" loading={busy} onClick={() => void startRecording()}>
            <Mic className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> {t('record')}
          </Button>
        )}
      </div>

      {status === 'recording' && (
        <p className="flex items-center gap-1.5 text-xs text-danger" aria-live="polite">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-danger" /> {t('recording')}
        </p>
      )}
      {busy && (
        <p className="flex items-center gap-1.5 text-xs text-muted" aria-live="polite">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          {status === 'uploading' ? t('uploading') : t('processing')}
        </p>
      )}
      {status === 'ready' && understood && (
        <p className="text-center text-xs text-muted" aria-live="polite">
          {t('understood')} <span className="text-foreground">{understood}</span>
        </p>
      )}
      <p className="text-center text-2xs text-muted">
        {t('tip')}
      </p>
    </div>
  );
}
