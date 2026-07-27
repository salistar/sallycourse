'use client';

import * as React from 'react';
import { AlertTriangle, Trash2, UploadCloud, UserRound } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, useToast } from '@/components/ui';
import { useTranslations } from 'next-intl';
import { errorMessage } from '@/lib/error-message';

// Section « Mon avatar » : upload d'une photo de visage (portrait frontal) qui
// sert de présentateur « talking-head » (Ditto/Modal). La photo est animée sur
// la narration (mouvements de tête, clignements, lip-sync) en intro/conclusion
// de chaque section, quand l'option Avatar est activée à la création d'un cours.

const ENDPOINT = '/api/account/avatar-face';

type Phase = 'loading' | 'idle' | 'uploading';

export function AvatarFaceManager() {
  const { toast } = useToast();
  const t = useTranslations('settings.avatar');
  const tApiError = useTranslations('apiErrors');
  const [phase, setPhase] = React.useState<Phase>('loading');
  const [hasFace, setHasFace] = React.useState(false);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [consentChecked, setConsentChecked] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(ENDPOINT, { method: 'GET' });
        const data = (await res.json().catch(() => null)) as { hasFace?: boolean } | null;
        if (!cancelled && data) setHasFace(Boolean(data.hasFace));
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
          title: t('consentRequiredTitle'),
          description: t('consentRequiredDesc'),
          variant: 'danger',
        });
        return;
      }
      setPhase('uploading');
      try {
        const body = new FormData();
        body.append('file', file);
        const res = await fetch(ENDPOINT, { method: 'POST', body });
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        if (!res.ok) {
          toast({ title: t('uploadFailedTitle'), description: errorMessage(data, tApiError), variant: 'danger' });
          setPhase('idle');
          return;
        }
        setPreviewUrl(URL.createObjectURL(file));
        setHasFace(true);
        toast({ title: t('photoSavedTitle'), description: t('photoSavedDesc'), variant: 'success' });
      } catch {
        toast({ title: t('networkErrorTitle'), description: t('serverUnreachable'), variant: 'danger' });
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
        setHasFace(false);
        setPreviewUrl(null);
        setConsentChecked(false);
        toast({ title: t('photoDeletedTitle'), variant: 'success' });
      } else {
        toast({ title: t('deleteFailedTitle'), variant: 'danger' });
      }
    } catch {
      toast({ title: t('networkErrorTitle'), variant: 'danger' });
    } finally {
      setRemoving(false);
    }
  }, [toast]);

  return (
    <Card>
      <CardHeader className="gap-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <UserRound className="size-5 text-accent" aria-hidden="true" />
          {t('title')}
        </CardTitle>
        <CardDescription>
          {t('description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Badge variant={hasFace ? 'ready' : 'draft'}>{hasFace ? t('badgeSaved') : t('badgeNone')}</Badge>
          {previewUrl ? (
            <img src={previewUrl} alt={t('previewAlt')} className="size-12 rounded-full object-cover" />
          ) : null}
        </div>

        {hasFace ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              {t('useHint')}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                loading={phase === 'uploading'}
                onClick={() => inputRef.current?.click()}
              >
                {phase !== 'uploading' && <UploadCloud aria-hidden="true" />}
                {t('replacePhoto')}
              </Button>
              <Button variant="ghost" size="sm" loading={removing} onClick={() => void onRemove()}>
                {!removing && <Trash2 aria-hidden="true" />}
                {t('remove')}
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
                {t('consentLabel')}
              </span>
            </label>
            {!consentChecked && (
              <p className="flex items-center gap-1.5 text-xs text-muted">
                <AlertTriangle className="size-3.5" aria-hidden="true" />
                {t('uploadBlockedHint')}
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
                {phase === 'uploading' ? t('uploading') : t('uploadPhoto')}
              </Button>
            </div>
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
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
