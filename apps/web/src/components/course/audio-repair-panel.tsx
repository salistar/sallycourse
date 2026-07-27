'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeftRight, Wrench } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Select, useToast } from '@/components/ui';
import { errorMessage } from '@/lib/error-message';

/**
 * « Réparer l'audio » (Lot 2, plan 2026-07-20) : une leçon vidéo déjà générée
 * peut encore contenir du bruit de fond ou des vides internes malgré les
 * correctifs du pipeline TTS. Deux modes, choisis par l'auteur :
 *  - 'denoise' : nettoyage rapide (ffmpeg, quelques secondes), ne corrige pas
 *    les vides ;
 *  - 'resynth' : diagnostic ciblé + re-synthèse des SEULES slides fautives
 *    (peut prendre plusieurs minutes, ré-enfile un rendu vidéo complet).
 * Suit la progression par polling (même patron que ScreencastPanel).
 *
 * Bouton « essayer l'autre voix » (audit qualité modèles 2026-07-22, additif) :
 * bascule TOUTES les slides de la leçon vers l'autre moteur TTS (Chatterbox ⇄
 * Qwen3-TTS), sans diagnostic — utile quand la réparation ciblée ne suffit
 * pas (défaut du modèle lui-même, pas de l'assemblage). Mode 'switch-voice'
 * côté serveur, même file d'attente/polling que la réparation.
 */
export interface AudioRepairPanelProps {
  courseId: string;
  lessonId: string;
  lessonTitle: string;
}

type RepairStatus = 'loading' | 'idle' | 'pending' | 'running' | 'ready' | 'failed';
type RepairMode = 'resynth' | 'denoise' | 'switch-voice';
type TtsEngine = 'chatterbox' | 'qwen3';

interface RepairReport {
  mode: RepairMode;
  ranAt: string;
  gapsFound?: number;
  slidesRepaired?: number[];
  error?: string;
  targetEngine?: TtsEngine;
}

interface GetResponse {
  status?: RepairStatus;
  report?: RepairReport | null;
  currentEngine?: TtsEngine;
}

const ENDPOINT = (courseId: string, lessonId: string): string =>
  `/api/courses/${courseId}/lessons/${lessonId}/audio-repair`;

const POLL_MS = 4000;

export function AudioRepairPanel({ courseId, lessonId, lessonTitle }: AudioRepairPanelProps) {
  const t = useTranslations('course.audioRepair');
  const tApiError = useTranslations('apiErrors');
  const { toast } = useToast();
  const [status, setStatus] = React.useState<RepairStatus>('loading');
  const [report, setReport] = React.useState<RepairReport | null>(null);
  const [mode, setMode] = React.useState<RepairMode>('resynth');
  const [submitting, setSubmitting] = React.useState(false);
  const [switching, setSwitching] = React.useState(false);
  const [currentEngine, setCurrentEngine] = React.useState<TtsEngine>('chatterbox');

  const applyGet = React.useCallback((data: GetResponse | null) => {
    setStatus(data?.status ?? 'idle');
    setReport(data?.report ?? null);
    setCurrentEngine(data?.currentEngine ?? 'chatterbox');
  }, []);

  // État initial au montage.
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(ENDPOINT(courseId, lessonId), { method: 'GET' });
        const data = (await res.json().catch(() => null)) as GetResponse | null;
        if (!cancelled) applyGet(data);
      } catch {
        if (!cancelled) setStatus('idle');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId, lessonId, applyGet]);

  // Polling pendant la réparation (pending/running).
  React.useEffect(() => {
    if (status !== 'pending' && status !== 'running') return;
    let cancelled = false;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const res = await fetch(ENDPOINT(courseId, lessonId), { method: 'GET' });
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
  }, [status, courseId, lessonId, applyGet]);

  const onSubmit = React.useCallback(async () => {
    setSubmitting(true);
    try {
      const res = await fetch(ENDPOINT(courseId, lessonId), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({ title: t('failedTitle'), description: errorMessage(data, tApiError), variant: 'danger' });
        return;
      }
      setStatus('pending');
      setReport(null);
      toast({
        title: t('startedTitle'),
        description: t('startedDescription', { title: lessonTitle }),
        variant: 'success',
      });
    } catch {
      toast({ title: t('networkErrorTitle'), description: t('networkErrorDescription'), variant: 'danger' });
    } finally {
      setSubmitting(false);
    }
  }, [courseId, lessonId, lessonTitle, mode, toast, t, tApiError]);

  const otherEngine: TtsEngine = currentEngine === 'qwen3' ? 'chatterbox' : 'qwen3';

  const onSwitchVoice = React.useCallback(async () => {
    setSwitching(true);
    try {
      const res = await fetch(ENDPOINT(courseId, lessonId), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'switch-voice', targetEngine: otherEngine }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({ title: t('failedTitle'), description: errorMessage(data, tApiError), variant: 'danger' });
        return;
      }
      setStatus('pending');
      setReport(null);
      toast({
        title: t('switchStartedTitle'),
        description: t('switchStartedDescription', { title: lessonTitle, engine: t(`engine.${otherEngine}`) }),
        variant: 'success',
      });
    } catch {
      toast({ title: t('networkErrorTitle'), description: t('networkErrorDescription'), variant: 'danger' });
    } finally {
      setSwitching(false);
    }
  }, [courseId, lessonId, lessonTitle, otherEngine, toast, t, tApiError]);

  const running = status === 'pending' || status === 'running';

  const statusBadge = (): React.ReactNode => {
    switch (status) {
      case 'pending':
      case 'running':
        return <Badge variant="generating">{t('statusRunning')}</Badge>;
      case 'ready':
        return <Badge variant="ready">{t('statusReady')}</Badge>;
      case 'failed':
        return <Badge variant="failed">{t('statusFailed')}</Badge>;
      default:
        return null;
    }
  };

  const reportLine = (): string | null => {
    if (!report) return null;
    if (report.error) return t('reportError', { error: report.error });
    if (report.mode === 'denoise') return t('reportDenoise');
    if (report.mode === 'switch-voice') {
      return t('reportSwitchVoice', { engine: t(`engine.${report.targetEngine ?? 'chatterbox'}`) });
    }
    const repaired = report.slidesRepaired?.length ?? 0;
    if (repaired === 0) return t('reportNoIssues');
    return t('reportSummary', { repaired, gaps: report.gapsFound ?? repaired });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wrench aria-hidden="true" className="size-5" />
          {t('title')}
          <span className="ms-auto">{statusBadge()}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {reportLine() && <p className="text-sm text-muted">{reportLine()}</p>}

        <Select
          label={t(mode === 'resynth' ? 'resynthLabel' : 'denoiseLabel')}
          value={mode}
          disabled={running}
          onChange={(e) => setMode(e.target.value as RepairMode)}
        >
          <option value="resynth">{t('resynthLabel')}</option>
          <option value="denoise">{t('denoiseLabel')}</option>
        </Select>
        <p className="text-2xs text-muted">{t(mode === 'resynth' ? 'resynthHint' : 'denoiseHint')}</p>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" loading={submitting} disabled={running || switching} onClick={onSubmit}>
            <Wrench aria-hidden="true" />
            {running ? t('statusRunning') : t('button')}
          </Button>

          {/* Bouton « essayer l'autre voix » (audit qualité modèles 2026-07-22,
              additif) — bascule TOUTE la leçon vers l'autre moteur TTS, sans
              diagnostic préalable : utile quand la réparation ciblée ne suffit
              pas (défaut du modèle lui-même). */}
          <Button
            variant="ghost"
            size="sm"
            loading={switching}
            disabled={running || submitting}
            onClick={onSwitchVoice}
          >
            <ArrowLeftRight aria-hidden="true" />
            {t('switchVoiceButton', { engine: t(`engine.${otherEngine}`) })}
          </Button>
        </div>
        <p className="text-2xs text-muted">
          {t('switchVoiceHint', { current: t(`engine.${currentEngine}`) })}
        </p>
      </CardContent>
    </Card>
  );
}
