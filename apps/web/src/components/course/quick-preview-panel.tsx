'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Gauge, Sparkles } from 'lucide-react';
import { Button, useToast } from '@/components/ui';
import { errorMessage } from '@/lib/error-message';
// Sous-module direct (et non le barrel @sallycourse/shared) : le barrel
// réexporte crypto.ts (node:crypto), incompatible avec le bundle client.
import {
  QUICK_PREVIEW_SPEEDUP_LABEL,
  isEligibleForFinal,
  type VideoQualityStatus,
} from '@sallycourse/shared/video-preview';
import type { LessonView } from './types';

/**
 * Panneau « Aperçu rapide (brouillon) » (Prompt 133) — affiché dès que le
 * cours contient au moins une leçon vidéo. Deux actions :
 *   1. « Générer un aperçu rapide (brouillon) » → POST quick-preview, TOUTES
 *      les leçons vidéo d'un coup (preset draft + voix TTS standard, ~5x).
 *   2. « Générer la version finale HD » → POST finalize-video, UNIQUEMENT les
 *      leçons déjà approuvées (cf. ApprovePreviewButton par leçon).
 * Repose sur Lesson.videoQualityStatus (additif) pour compter les leçons
 * éligibles à chaque étape — logique de sélection PURE côté shared
 * (selectLessonsForMode) déjà appliquée serveur ; ce panneau n'affiche que des
 * compteurs dérivés localement pour le libellé des boutons.
 */
export interface QuickPreviewPanelProps {
  courseId: string;
  videoLessons: Pick<LessonView, 'id' | 'videoQualityStatus'>[];
}

export function QuickPreviewPanel({ courseId, videoLessons }: QuickPreviewPanelProps) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useTranslations('course.quickPreview');
  const tApiError = useTranslations('apiErrors');
  const [loadingPreview, setLoadingPreview] = React.useState(false);
  const [loadingFinal, setLoadingFinal] = React.useState(false);

  if (videoLessons.length === 0) return null;

  const approvedCount = videoLessons.filter((l) =>
    isEligibleForFinal((l.videoQualityStatus ?? 'none') as VideoQualityStatus),
  ).length;

  const post = async (
    path: string,
    setLoading: (v: boolean) => void,
    successTitle: string,
  ) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/courses/${courseId}/${path}`, { method: 'POST' });
      const data = (await res.json().catch(() => null)) as { error?: string; queuedLessons?: number } | null;
      if (res.ok) {
        toast({
          title: successTitle,
          description: t('queuedDescription', { count: data?.queuedLessons ?? 0 }),
          variant: 'success',
        });
        router.refresh();
      } else {
        toast({
          title: t('actionImpossibleTitle'),
          description: errorMessage(data, tApiError),
          variant: 'danger',
        });
      }
    } catch {
      toast({
        title: t('networkErrorTitle'),
        description: t('networkErrorDescription'),
        variant: 'danger',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <Gauge className="size-4 text-primary" aria-hidden="true" />
            {t('title')}
          </p>
          <p className="mt-1 text-xs text-muted">
            {t('description')}
          </p>
          <p className="mt-1 inline-flex items-center gap-1 text-2xs font-semibold uppercase tracking-wide text-accent">
            <Sparkles className="size-3.5" aria-hidden="true" />
            {QUICK_PREVIEW_SPEEDUP_LABEL}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            loading={loadingPreview}
            onClick={() => post('quick-preview', setLoadingPreview, t('draftLaunchedToast'))}
          >
            {t('generateDraftButton')}
          </Button>
          <span title={approvedCount === 0 ? t('finalDisabledHint') : undefined} className="inline-flex">
            <Button
              variant="gold"
              size="sm"
              loading={loadingFinal}
              disabled={approvedCount === 0}
              onClick={() => post('finalize-video', setLoadingFinal, t('finalLaunchedToast'))}
            >
              {t('generateFinalButton')}{approvedCount > 0 ? ` (${approvedCount})` : ''}
            </Button>
          </span>
        </div>
      </div>
    </section>
  );
}
