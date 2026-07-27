'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ImageIcon, Trash2, Upload } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  useToast,
} from '@/components/ui';
import { errorMessage } from '@/lib/error-message';

/**
 * Panneau « Image de couverture » (2026-07-26) : affiche la couverture actuelle
 * du cours (hero SDXL généré ou image uploadée) et permet de la REMPLACER par
 * un fichier de l'auteur (PNG/JPEG/WebP, ≤ 8 Mo) ou de revenir au hero généré.
 * Se synchronise seul via GET /api/courses/[id]/cover au montage.
 */
export interface CoverPanelProps {
  courseId: string;
  /** URL présignée initiale (hero marketing) pour éviter un flash au montage. */
  initialUrl?: string;
}

type CoverSource = 'generated' | 'uploaded' | null;
const ACCEPTED = 'image/png,image/jpeg,image/webp';

export function CoverPanel({ courseId, initialUrl }: CoverPanelProps) {
  const t = useTranslations('course.cover');
  const tApiError = useTranslations('apiErrors');
  const { toast } = useToast();
  const router = useRouter();
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [url, setUrl] = React.useState<string | undefined>(initialUrl);
  const [source, setSource] = React.useState<CoverSource>(null);
  const [busy, setBusy] = React.useState(false);
  const endpoint = `/api/courses/${courseId}/cover`;

  React.useEffect(() => {
    let alive = true;
    void fetch(endpoint)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { url?: string; source?: CoverSource } | null) => {
        if (!alive || !data) return;
        if (data.url) setUrl(data.url);
        setSource(data.source ?? null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [endpoint]);

  const onPick = () => fileInputRef.current?.click();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(endpoint, { method: 'POST', body });
      const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (res.ok) {
        if (data?.url) setUrl(data.url);
        setSource('uploaded');
        toast({ title: t('uploadedTitle'), description: t('uploadedDescription'), variant: 'success' });
        router.refresh();
      } else {
        toast({ title: t('failedTitle'), description: errorMessage(data, tApiError), variant: 'danger' });
      }
    } catch {
      toast({ title: t('failedTitle'), description: t('networkError'), variant: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const onRevert = async () => {
    setBusy(true);
    try {
      const res = await fetch(endpoint, { method: 'DELETE' });
      const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (res.ok) {
        setUrl(data?.url);
        setSource(data?.url ? 'generated' : null);
        toast({ title: t('revertedTitle'), description: t('revertedDescription'), variant: 'success' });
        router.refresh();
      } else {
        toast({ title: t('failedTitle'), description: errorMessage(data, tApiError), variant: 'danger' });
      }
    } catch {
      toast({ title: t('failedTitle'), description: t('networkError'), variant: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ImageIcon aria-hidden="true" className="size-4" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="relative aspect-video w-full max-w-xs shrink-0 overflow-hidden rounded-md border border-border bg-surface-subtle">
            {url ? (
              // URL S3 présignée, hors optimiseur Next : <img> natif nécessaire.
              <img src={url} alt={t('previewAlt')} className="size-full object-cover" />
            ) : (
              <div className="flex size-full items-center justify-center text-2xs text-muted">
                {t('noCover')}
              </div>
            )}
            {source && (
              <Badge variant="draft" className="absolute left-2 top-2">
                {source === 'uploaded' ? t('sourceUploaded') : t('sourceGenerated')}
              </Badge>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED}
              className="hidden"
              onChange={onFile}
            />
            <Button size="sm" variant="secondary" onClick={onPick} loading={busy} disabled={busy}>
              <Upload aria-hidden="true" className="size-4" />
              {t('upload')}
            </Button>
            {source === 'uploaded' && (
              <Button size="sm" variant="ghost" onClick={onRevert} loading={busy} disabled={busy}>
                <Trash2 aria-hidden="true" className="size-4" />
                {t('revert')}
              </Button>
            )}
            <p className="max-w-xs text-2xs text-muted">{t('hint')}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
