'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { errorMessage } from '@/lib/error-message';
import { AlertTriangle, Mic, Square, Trash2, UploadCloud } from 'lucide-react';
import {
  MIN_VOICE_SAMPLE_SECONDS,
  canSubmitRecording,
  formatRecordingTime,
  remainingSecondsBeforeSubmit,
} from '@sallycourse/shared/voice-recording';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, useToast } from '@/components/ui';
import { useAudioRecorder } from '@/hooks/use-audio-recorder';

// Section « Ma voix » (Prompt 81) : upload d'un échantillon audio (>= 60s
// recommandé) avec consentement explicite obligatoire → clonage ElevenLabs
// (ou mock déterministe sans clé). Le voiceId obtenu peut ensuite être choisi
// comme Course.ttsVoice à la création d'un cours. Chaque audio généré avec
// cette voix est logué (traçabilité conformité — voir notification
// « voice_clone_used » émise côté worker).

const ENDPOINT = '/api/account/voice-clone';
const MIN_SAMPLE_SECONDS = MIN_VOICE_SAMPLE_SECONDS;

interface VoiceStatus {
  voiceId: string | null;
  status: 'none' | 'pending' | 'ready' | 'failed';
  consent: boolean;
  sampleSeconds: number | null;
}

type Phase = 'loading' | 'idle' | 'uploading';

/** Lit la durée (s) d'un fichier audio via l'API Web Audio native (pas de dépendance). */
function readAudioDurationSeconds(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(audio.duration);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('lecture audio impossible'));
    };
    audio.src = url;
  });
}

const STATUS_LABEL_KEY: Record<VoiceStatus['status'], string> = {
  none: 'statusNone',
  pending: 'statusPending',
  ready: 'statusReady',
  failed: 'statusFailed',
};

const STATUS_BADGE_VARIANT: Record<VoiceStatus['status'], 'draft' | 'generating' | 'ready' | 'failed'> = {
  none: 'draft',
  pending: 'generating',
  ready: 'ready',
  failed: 'failed',
};

export function VoiceCloneManager() {
  const t = useTranslations('settings.voice');
  const tApiError = useTranslations('apiErrors');
  const { toast } = useToast();
  const [phase, setPhase] = React.useState<Phase>('loading');
  const [status, setStatus] = React.useState<VoiceStatus>({
    voiceId: null,
    status: 'none',
    consent: false,
    sampleSeconds: null,
  });
  const [consentChecked, setConsentChecked] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const recorder = useAudioRecorder();

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(ENDPOINT, { method: 'GET' });
        const data = (await res.json().catch(() => null)) as VoiceStatus | null;
        if (cancelled) return;
        if (data) setStatus(data);
      } finally {
        if (!cancelled) setPhase('idle');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Cœur d'upload partagé par le fichier téléversé ET l'enregistrement micro :
  // même endpoint, mêmes champs multipart, même gestion de réponse.
  const uploadSample = React.useCallback(
    async (source: File | Blob, filename: string, durationSeconds: number) => {
      setPhase('uploading');
      try {
        const body = new FormData();
        body.append('file', source, filename);
        body.append('consent', 'true');
        body.append('durationSeconds', String(durationSeconds));
        body.append('label', 'Ma voix');

        const res = await fetch(ENDPOINT, { method: 'POST', body });
        const data = (await res.json().catch(() => null)) as
          | { error?: string; voiceId?: string; mock?: boolean; sampleSeconds?: number }
          | null;

        if (!res.ok) {
          toast({ title: t('toastCloneFailedTitle'), description: errorMessage(data, tApiError), variant: 'danger' });
          return;
        }

        setStatus({
          voiceId: data?.voiceId ?? null,
          status: 'ready',
          consent: true,
          sampleSeconds: data?.sampleSeconds ?? null,
        });
        toast({
          title: t('toastClonedTitle'),
          description: data?.mock
            ? t('toastClonedMock')
            : t('toastClonedReady'),
          variant: 'success',
        });
      } catch {
        toast({ title: t('toastNetworkError'), description: t('toastServerUnreachable'), variant: 'danger' });
      } finally {
        setPhase('idle');
      }
    },
    [toast],
  );

  const onPick = React.useCallback(
    async (file: File) => {
      if (!consentChecked) {
        toast({
          title: t('toastConsentRequiredTitle'),
          description: t('toastConsentRequiredUpload'),
          variant: 'danger',
        });
        return;
      }

      // La durée d'un fichier téléversé est lisible (contrairement aux blobs webm
      // du micro) : on la mesure pour bloquer un échantillon trop court côté client.
      const durationSeconds = await readAudioDurationSeconds(file).catch(() => 0);
      if (durationSeconds > 0 && durationSeconds < MIN_SAMPLE_SECONDS) {
        toast({
          title: t('toastTooShortTitle'),
          description: t('toastTooShortDescription', { detected: Math.round(durationSeconds), min: MIN_SAMPLE_SECONDS }),
          variant: 'danger',
        });
        return;
      }

      await uploadSample(file, file.name || 'sample', durationSeconds || MIN_SAMPLE_SECONDS);
    },
    [consentChecked, toast, uploadSample],
  );

  const onStartRecording = React.useCallback(async () => {
    if (!consentChecked) {
      toast({
        title: t('toastConsentRequiredTitle'),
        description: t('toastConsentRequiredRecord'),
        variant: 'danger',
      });
      return;
    }
    if (!recorder.supported) {
      toast({
        title: t('toastMicUnavailableTitle'),
        description: t('toastMicUnavailableDescription'),
        variant: 'danger',
      });
      return;
    }
    try {
      await recorder.start();
    } catch {
      toast({
        title: t('toastMicDeniedTitle'),
        description: t('toastMicDeniedDescription'),
        variant: 'warning',
      });
    }
  }, [consentChecked, recorder, toast]);

  // La DURÉE vient du minuteur (secondes écoulées), pas de HTMLAudioElement.duration.
  const onUseRecording = React.useCallback(async () => {
    const seconds = recorder.elapsedSeconds;
    if (!canSubmitRecording(seconds, MIN_SAMPLE_SECONDS)) return;
    let blob: Blob;
    try {
      blob = await recorder.stop();
    } catch {
      return;
    }
    if (blob.size === 0) {
      toast({ title: t('toastEmptyRecordingTitle'), description: t('toastEmptyRecordingDescription'), variant: 'danger' });
      return;
    }
    await uploadSample(blob, 'sample.webm', seconds);
  }, [recorder, toast, uploadSample]);

  const onRemove = React.useCallback(async () => {
    setRemoving(true);
    try {
      const res = await fetch(ENDPOINT, { method: 'DELETE' });
      if (res.ok) {
        setStatus({ voiceId: null, status: 'none', consent: false, sampleSeconds: null });
        setConsentChecked(false);
        toast({ title: t('toastRemovedTitle'), variant: 'success' });
      } else {
        toast({ title: t('toastRemoveFailedTitle'), variant: 'danger' });
      }
    } catch {
      toast({ title: t('toastNetworkError'), variant: 'danger' });
    } finally {
      setRemoving(false);
    }
  }, [toast]);

  const hasVoice = status.status === 'ready' && status.voiceId;

  return (
    <Card>
      <CardHeader className="gap-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Mic className="size-5 text-accent" aria-hidden="true" />
          {t('cardTitle')}
        </CardTitle>
        <CardDescription>
          {t('description', { seconds: MIN_SAMPLE_SECONDS })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge variant={STATUS_BADGE_VARIANT[status.status]}>{t(STATUS_LABEL_KEY[status.status])}</Badge>
          {status.sampleSeconds ? (
            <span className="text-sm text-muted">{t('sampleDuration', { seconds: status.sampleSeconds })}</span>
          ) : null}
        </div>

        {hasVoice ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              {t('useVoiceHint')}
            </p>
            <div>
              <Button variant="ghost" size="sm" loading={removing} onClick={() => void onRemove()}>
                {!removing && <Trash2 aria-hidden="true" />}
                {t('removeButton')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <label className="flex items-start gap-2 text-sm text-muted">
              <input
                type="checkbox"
                className="mt-0.5 size-4 rounded border-border accent-accent"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                disabled={phase === 'uploading' || recorder.status === 'recording'}
              />
              <span>
                {t('consentLabel')}
              </span>
            </label>

            {!consentChecked && (
              <p className="flex items-center gap-1.5 text-xs text-muted">
                <AlertTriangle className="size-3.5" aria-hidden="true" />
                {t('consentBlockedHint')}
              </p>
            )}

            <div>
              <Button
                variant="secondary"
                size="sm"
                loading={phase === 'uploading'}
                disabled={phase === 'loading' || !consentChecked || recorder.status === 'recording'}
                onClick={() => inputRef.current?.click()}
              >
                {phase !== 'uploading' && <UploadCloud aria-hidden="true" />}
                {phase === 'uploading' ? t('uploadingButton') : t('uploadButton')}
              </Button>
            </div>

            {recorder.supported && (
              <div className="flex flex-col gap-2 rounded-lg border border-input bg-surface/50 p-3">
                <div className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-widest text-muted">
                  <Mic className="h-3.5 w-3.5" aria-hidden="true" /> {t('orRecordMic')}
                </div>

                {recorder.status === 'recording' ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-danger" aria-hidden="true" />
                      <span className="font-mono text-sm text-foreground" aria-live="polite">
                        {formatRecordingTime(recorder.elapsedSeconds)}
                      </span>
                      <span className="text-xs text-muted">
                        / {formatRecordingTime(MIN_SAMPLE_SECONDS)} {t('recordingMinAbbrev')}
                      </span>
                    </div>

                    {!canSubmitRecording(recorder.elapsedSeconds, MIN_SAMPLE_SECONDS) && (
                      <p className="flex items-center gap-1.5 text-xs text-muted" aria-live="polite">
                        <AlertTriangle className="size-3.5" aria-hidden="true" />
                        {t('recordMoreHint', { remaining: remainingSecondsBeforeSubmit(recorder.elapsedSeconds, MIN_SAMPLE_SECONDS), min: MIN_SAMPLE_SECONDS })}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!canSubmitRecording(recorder.elapsedSeconds, MIN_SAMPLE_SECONDS)}
                        onClick={() => void onUseRecording()}
                      >
                        <Square className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                        {t('useRecordingButton')}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => recorder.reset()}>
                        {t('cancelButton')}
                      </Button>
                    </div>
                  </>
                ) : (
                  <div>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={phase !== 'idle' || !consentChecked}
                      onClick={() => void onStartRecording()}
                    >
                      <Mic className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                      {t('recordMicButton')}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="audio/mpeg,audio/mp3,audio/wav,audio/webm,audio/mp4"
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
