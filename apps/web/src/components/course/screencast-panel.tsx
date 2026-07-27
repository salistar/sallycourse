'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { errorMessage } from '@/lib/error-message';
import { Clapperboard, Plus, Trash2, UploadCloud } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Progress,
  Select,
  Textarea,
  useToast,
} from '@/components/ui';
import {
  MAX_SCREENCAST_NARRATION,
  MAX_SCREENCAST_OVERLAYS,
  MAX_SCREENCAST_OVERLAY_TEXT,
  SCREENCAST_OVERLAY_POSITIONS,
  type ScreencastOverlayPosition,
} from '@sallycourse/shared/schemas/screencast';

/**
 * Éditeur de CAPTURE D'ÉCRAN narrée (Feature B) : l'auteur téléverse un
 * enregistrement d'écran, saisit le texte de narration (synthétisé avec la voix
 * du cours) et une liste de LÉGENDES CHRONOMÉTRÉES à incruster, puis lance le
 * rendu asynchrone. Suit la progression par polling (patron voice-dictation) et
 * lit le MP4 final une fois prêt. L'upload/aperçu reprend le patron
 * intro-video-upload. Le MP4 rendu s'AJOUTE comme asset screencast de la leçon.
 */
export interface ScreencastPanelProps {
  courseId: string;
  lessonId: string;
}

/** Statut du rendu (miroir de Lesson.assets.screencastStatus + 'loading' UI). */
type RenderStatus = 'loading' | 'idle' | 'pending' | 'rendering' | 'ready' | 'failed';

/** Légende éditable côté client (position toujours renseignée pour l'édition). */
interface EditableOverlay {
  text: string;
  startSec: number;
  endSec: number;
  position: ScreencastOverlayPosition;
}

interface GetResponse {
  status?: RenderStatus;
  url?: string;
  overlays?: unknown;
  narrationText?: string;
}

const ENDPOINT = (courseId: string, lessonId: string): string =>
  `/api/courses/${courseId}/lessons/${lessonId}/screencast`;

const POLL_MS = 4000;

/** Normalise une valeur inconnue en légende éditable (défensif sur le JSON stocké). */
function toEditableOverlay(raw: unknown): EditableOverlay | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const position = SCREENCAST_OVERLAY_POSITIONS.includes(o.position as ScreencastOverlayPosition)
    ? (o.position as ScreencastOverlayPosition)
    : 'bottom';
  return {
    text: typeof o.text === 'string' ? o.text : '',
    startSec: typeof o.startSec === 'number' ? o.startSec : 0,
    endSec: typeof o.endSec === 'number' ? o.endSec : 0,
    position,
  };
}

export function ScreencastPanel({ courseId, lessonId }: ScreencastPanelProps) {
  const t = useTranslations('screencast');
  const tApiError = useTranslations('apiErrors');
  const { toast } = useToast();
  const [status, setStatus] = React.useState<RenderStatus>('loading');
  const [narrationText, setNarrationText] = React.useState('');
  const [overlays, setOverlays] = React.useState<EditableOverlay[]>([]);
  const [renderUrl, setRenderUrl] = React.useState<string | undefined>(undefined);
  const [file, setFile] = React.useState<File | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  // Poll : n'actualise QUE le statut et l'URL du rendu — jamais les champs
  // éditables (narration / légendes), sinon un tick écraserait ce que l'auteur
  // tape pendant qu'il attend le rendu.
  const applyStatus = React.useCallback((data: GetResponse | null) => {
    if (!data) {
      setStatus('idle');
      return;
    }
    setStatus(data.status ?? 'idle');
    setRenderUrl(data.url);
  }, []);

  // Hydratation initiale (au montage) : renseigne aussi les champs éditables.
  const applyGet = React.useCallback(
    (data: GetResponse | null) => {
      applyStatus(data);
      if (!data) return;
      if (typeof data.narrationText === 'string' && data.narrationText) setNarrationText(data.narrationText);
      if (Array.isArray(data.overlays)) {
        const parsed = data.overlays.map(toEditableOverlay).filter((o): o is EditableOverlay => o !== null);
        if (parsed.length > 0) setOverlays(parsed);
      }
    },
    [applyStatus],
  );

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

  // Polling pendant le rendu (pending/rendering).
  React.useEffect(() => {
    if (status !== 'pending' && status !== 'rendering') return;
    let cancelled = false;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const res = await fetch(ENDPOINT(courseId, lessonId), { method: 'GET' });
          const data = (await res.json().catch(() => null)) as GetResponse | null;
          if (!cancelled) applyStatus(data);
        } catch {
          /* réseau instable : on retentera au prochain tick */
        }
      })();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [status, courseId, lessonId, applyStatus]);

  const addOverlay = React.useCallback(() => {
    setOverlays((prev) => {
      if (prev.length >= MAX_SCREENCAST_OVERLAYS) return prev;
      const lastEnd = prev.length > 0 ? prev[prev.length - 1]!.endSec : 0;
      return [...prev, { text: '', startSec: lastEnd, endSec: lastEnd + 4, position: 'bottom' }];
    });
  }, []);

  const updateOverlay = React.useCallback((index: number, patch: Partial<EditableOverlay>) => {
    setOverlays((prev) => prev.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  }, []);

  const removeOverlay = React.useCallback((index: number) => {
    setOverlays((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const onSubmit = React.useCallback(async () => {
    if (!file) {
      toast({ title: t('needFile'), variant: 'danger' });
      return;
    }
    if (!narrationText.trim()) {
      toast({ title: t('needNarration'), variant: 'danger' });
      return;
    }
    // Validation cliente légère (le schéma partagé re-valide côté serveur).
    const cleanOverlays = overlays
      .map((o) => ({ ...o, text: o.text.trim() }))
      .filter((o) => o.text.length > 0);
    const invalid = cleanOverlays.find((o) => !(o.endSec > o.startSec) || o.startSec < 0);
    if (invalid) {
      toast({ title: t('invalidCaption'), variant: 'danger' });
      return;
    }

    setSubmitting(true);
    const body = new FormData();
    body.append('file', file);
    body.append('narrationText', narrationText.trim());
    body.append('overlays', JSON.stringify(cleanOverlays));
    try {
      const res = await fetch(ENDPOINT(courseId, lessonId), { method: 'POST', body });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({ title: t('error'), description: errorMessage(data, tApiError), variant: 'danger' });
        return;
      }
      setFile(null);
      setStatus('pending');
      setRenderUrl(undefined);
      toast({ title: t('started'), variant: 'success' });
    } catch {
      toast({ title: t('network'), variant: 'danger' });
    } finally {
      setSubmitting(false);
    }
  }, [file, narrationText, overlays, courseId, lessonId, toast, t]);

  const onRemove = React.useCallback(async () => {
    try {
      const res = await fetch(ENDPOINT(courseId, lessonId), { method: 'DELETE' });
      if (res.ok) {
        setStatus('idle');
        setRenderUrl(undefined);
        toast({ title: t('removed'), variant: 'success' });
      } else {
        toast({ title: t('error'), variant: 'danger' });
      }
    } catch {
      toast({ title: t('network'), variant: 'danger' });
    }
  }, [courseId, lessonId, toast, t]);

  const rendering = status === 'pending' || status === 'rendering';

  const statusBadge = (): React.ReactNode => {
    switch (status) {
      case 'pending':
      case 'rendering':
        return <Badge variant="generating">{t('statusRendering')}</Badge>;
      case 'ready':
        return <Badge variant="ready">{t('statusReady')}</Badge>;
      case 'failed':
        return <Badge variant="failed">{t('statusFailed')}</Badge>;
      default:
        return null;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clapperboard aria-hidden="true" className="size-5" />
          {t('title')}
          <span className="ms-auto">{statusBadge()}</span>
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Rendu final prêt : lecteur vidéo. */}
        {status === 'ready' && renderUrl && (
          <div className="space-y-2">
            <video src={renderUrl} controls className="w-full max-w-2xl rounded-lg border border-border" />
          </div>
        )}

        {/* Progression pendant le rendu. */}
        {rendering && <Progress label={t('statusRendering')} showLabel />}

        {status === 'failed' && (
          <p className="text-sm text-danger">{t('failedHelp')}</p>
        )}

        {/* Sélection de l'enregistrement. */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted">{t('recordingLabel')}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()} disabled={submitting}>
              <UploadCloud aria-hidden="true" />
              {file ? t('replaceFile') : t('pickFile')}
            </Button>
            {file && <span className="text-sm text-muted">{file.name}</span>}
          </div>
          <p className="text-2xs text-muted">{t('recordingHint')}</p>
          <input
            ref={inputRef}
            type="file"
            accept="video/mp4,video/quicktime,video/webm"
            className="hidden"
            onChange={(e) => {
              const picked = e.target.files?.[0];
              if (picked) setFile(picked);
              e.target.value = '';
            }}
          />
        </div>

        {/* Narration. */}
        <Textarea
          label={t('narrationLabel')}
          placeholder={t('narrationPlaceholder')}
          value={narrationText}
          maxLength={MAX_SCREENCAST_NARRATION}
          rows={4}
          onChange={(e) => setNarrationText(e.target.value)}
        />

        {/* Éditeur de légendes chronométrées. */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted">{t('captionsTitle')}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={addOverlay}
              disabled={overlays.length >= MAX_SCREENCAST_OVERLAYS}
            >
              <Plus aria-hidden="true" />
              {t('addCaption')}
            </Button>
          </div>

          {overlays.length === 0 ? (
            <p className="text-2xs text-muted">{t('captionsEmpty')}</p>
          ) : (
            <div className="space-y-3">
              {overlays.map((overlay, index) => (
                <div
                  key={index}
                  className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_auto_auto_auto_auto] sm:items-end"
                >
                  <Input
                    label={t('captionText')}
                    value={overlay.text}
                    maxLength={MAX_SCREENCAST_OVERLAY_TEXT}
                    onChange={(e) => updateOverlay(index, { text: e.target.value })}
                  />
                  <Input
                    label={t('captionStart')}
                    type="number"
                    min={0}
                    step={0.5}
                    value={Number.isFinite(overlay.startSec) ? overlay.startSec : 0}
                    className="w-24"
                    onChange={(e) => updateOverlay(index, { startSec: Number.parseFloat(e.target.value) || 0 })}
                  />
                  <Input
                    label={t('captionEnd')}
                    type="number"
                    min={0}
                    step={0.5}
                    value={Number.isFinite(overlay.endSec) ? overlay.endSec : 0}
                    className="w-24"
                    onChange={(e) => updateOverlay(index, { endSec: Number.parseFloat(e.target.value) || 0 })}
                  />
                  <Select
                    label={t('captionPosition')}
                    value={overlay.position}
                    onChange={(e) => updateOverlay(index, { position: e.target.value as ScreencastOverlayPosition })}
                  >
                    <option value="bottom">{t('positionBottom')}</option>
                    <option value="top">{t('positionTop')}</option>
                    <option value="center">{t('positionCenter')}</option>
                  </Select>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('removeCaption')}
                    onClick={() => removeOverlay(index)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actions. */}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" loading={submitting} disabled={rendering} onClick={onSubmit}>
            {rendering ? t('statusRendering') : t('submit')}
          </Button>
          {(status === 'ready' || status === 'failed') && (
            <Button variant="ghost" size="sm" onClick={onRemove}>
              <Trash2 aria-hidden="true" />
              {t('remove')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
