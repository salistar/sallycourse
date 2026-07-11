'use client';

import * as React from 'react';
import { AlertTriangle, Mic, Trash2, UploadCloud } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, useToast } from '@/components/ui';

// Section « Ma voix » (Prompt 81) : upload d'un échantillon audio (>= 60s
// recommandé) avec consentement explicite obligatoire → clonage ElevenLabs
// (ou mock déterministe sans clé). Le voiceId obtenu peut ensuite être choisi
// comme Course.ttsVoice à la création d'un cours. Chaque audio généré avec
// cette voix est logué (traçabilité conformité — voir notification
// « voice_clone_used » émise côté worker).

const ENDPOINT = '/api/account/voice-clone';
const MIN_SAMPLE_SECONDS = 60;

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

const STATUS_LABEL: Record<VoiceStatus['status'], string> = {
  none: 'Aucune voix clonée',
  pending: 'Clonage en cours',
  ready: 'Voix prête',
  failed: 'Échec du clonage',
};

const STATUS_BADGE_VARIANT: Record<VoiceStatus['status'], 'draft' | 'generating' | 'ready' | 'failed'> = {
  none: 'draft',
  pending: 'generating',
  ready: 'ready',
  failed: 'failed',
};

export function VoiceCloneManager() {
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

  const onPick = React.useCallback(
    async (file: File) => {
      if (!consentChecked) {
        toast({
          title: 'Consentement requis',
          description: 'Cochez la case de consentement avant de téléverser votre échantillon.',
          variant: 'danger',
        });
        return;
      }

      setPhase('uploading');
      try {
        const durationSeconds = await readAudioDurationSeconds(file).catch(() => 0);
        if (durationSeconds > 0 && durationSeconds < MIN_SAMPLE_SECONDS) {
          toast({
            title: 'Échantillon trop court',
            description: `Durée détectée : ${Math.round(durationSeconds)}s (minimum recommandé : ${MIN_SAMPLE_SECONDS}s).`,
            variant: 'danger',
          });
          setPhase('idle');
          return;
        }

        const body = new FormData();
        body.append('file', file);
        body.append('consent', 'true');
        body.append('durationSeconds', String(durationSeconds || MIN_SAMPLE_SECONDS));
        body.append('label', 'Ma voix');

        const res = await fetch(ENDPOINT, { method: 'POST', body });
        const data = (await res.json().catch(() => null)) as
          | { error?: string; voiceId?: string; mock?: boolean; sampleSeconds?: number }
          | null;

        if (!res.ok) {
          toast({ title: 'Clonage impossible', description: data?.error, variant: 'danger' });
          setPhase('idle');
          return;
        }

        setStatus({
          voiceId: data?.voiceId ?? null,
          status: 'ready',
          consent: true,
          sampleSeconds: data?.sampleSeconds ?? null,
        });
        toast({
          title: 'Voix clonée',
          description: data?.mock
            ? 'Mode simulé (aucune clé ElevenLabs) : un identifiant fictif a été assigné.'
            : 'Votre voix est prête à être utilisée pour vos cours.',
          variant: 'success',
        });
      } catch {
        toast({ title: 'Erreur réseau', description: 'Serveur injoignable.', variant: 'danger' });
      } finally {
        setPhase('idle');
      }
    },
    [consentChecked, toast],
  );

  const onRemove = React.useCallback(async () => {
    setRemoving(true);
    try {
      const res = await fetch(ENDPOINT, { method: 'DELETE' });
      if (res.ok) {
        setStatus({ voiceId: null, status: 'none', consent: false, sampleSeconds: null });
        setConsentChecked(false);
        toast({ title: 'Voix clonée supprimée', variant: 'success' });
      } else {
        toast({ title: 'Suppression impossible', variant: 'danger' });
      }
    } catch {
      toast({ title: 'Erreur réseau', variant: 'danger' });
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
          Ma voix
        </CardTitle>
        <CardDescription>
          Clonez votre voix (ElevenLabs) pour narrer vos cours vidéo avec votre propre timbre au
          lieu d’une voix de synthèse générique. Un échantillon d’au moins {MIN_SAMPLE_SECONDS}s,
          clair et sans bruit de fond, donne les meilleurs résultats.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge variant={STATUS_BADGE_VARIANT[status.status]}>{STATUS_LABEL[status.status]}</Badge>
          {status.sampleSeconds ? (
            <span className="text-sm text-muted">échantillon de {status.sampleSeconds}s</span>
          ) : null}
        </div>

        {hasVoice ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              Sélectionnez cette voix dans les options avancées lors de la création d’un cours pour
              l’utiliser comme narration.
            </p>
            <div>
              <Button variant="ghost" size="sm" loading={removing} onClick={() => void onRemove()}>
                {!removing && <Trash2 aria-hidden="true" />}
                Supprimer ma voix clonée
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
                disabled={phase === 'uploading'}
              />
              <span>
                Je consens explicitement à ce que SallyCourse crée un clone de ma voix à partir de
                l’échantillon téléversé, et l’utilise pour générer la narration de mes cours.
              </span>
            </label>

            {!consentChecked && (
              <p className="flex items-center gap-1.5 text-xs text-muted">
                <AlertTriangle className="size-3.5" aria-hidden="true" />
                Le téléversement est bloqué tant que le consentement n’est pas coché.
              </p>
            )}

            <div>
              <Button
                variant="secondary"
                size="sm"
                loading={phase === 'uploading'}
                disabled={phase === 'loading' || !consentChecked}
                onClick={() => inputRef.current?.click()}
              >
                {phase !== 'uploading' && <UploadCloud aria-hidden="true" />}
                {phase === 'uploading' ? 'Clonage en cours…' : 'Téléverser un échantillon audio'}
              </Button>
            </div>
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
