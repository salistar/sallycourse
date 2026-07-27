'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { errorMessage } from '@/lib/error-message';
import { CheckCircle2 } from 'lucide-react';
import { Badge, Button, useToast } from '@/components/ui';
import type { VideoQualityStatus } from './types';

/**
 * Statut du brouillon d'une leçon vidéo (Prompt 133) — affiché à côté du
 * badge de statut de génération existant. 'none' : rien à montrer (aucun
 * effet visuel pour les cours qui n'utilisent pas l'aperçu rapide).
 */
export interface ApprovePreviewButtonProps {
  lessonId: string;
  videoQualityStatus?: VideoQualityStatus;
}

export function ApprovePreviewButton({ lessonId, videoQualityStatus }: ApprovePreviewButtonProps) {
  const router = useRouter();
  const t = useTranslations('course.approvePreview');
  const tApiError = useTranslations('apiErrors');
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(false);

  const status = videoQualityStatus ?? 'none';
  if (status === 'none') return null;

  const approve = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/lessons/${lessonId}/approve-preview`, { method: 'POST' });
      if (res.ok) {
        toast({ title: t('approvedToastTitle'), description: t('approvedToastDescription'), variant: 'success' });
        router.refresh();
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({
          title: t('errorTitle'),
          description: errorMessage(data, tApiError),
          variant: 'danger',
        });
      }
    } catch {
      toast({ title: t('networkErrorTitle'), description: t('networkErrorDescription'), variant: 'danger' });
    } finally {
      setLoading(false);
    }
  };

  if (status === 'draft-ready') {
    return (
      <Button variant="secondary" size="sm" loading={loading} onClick={approve}>
        <CheckCircle2 aria-hidden="true" />
        {t('approveButton')}
      </Button>
    );
  }

  if (status === 'approved') {
    return <Badge variant="draft">{t('approvedBadge')}</Badge>;
  }

  if (status === 'final-ready') {
    return <Badge variant="ready">{t('hdDeliveredBadge')}</Badge>;
  }

  return null;
}
