'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { Button, useToast } from '@/components/ui';
import { useTranslations } from 'next-intl';
import { errorMessage } from '@/lib/error-message';

/**
 * « Régénérer la leçon » — POST /api/lessons/[id]/regenerate puis refresh
 * du Server Component pour refléter le passage en 'generating'.
 */
export interface RegenerateButtonProps {
  lessonId: string;
  lessonTitle: string;
  /** Leçon déjà en cours de génération : action neutralisée. */
  disabled?: boolean;
}

export function RegenerateButton({ lessonId, lessonTitle, disabled = false }: RegenerateButtonProps) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useTranslations('course.regenerate');
  const tApiError = useTranslations('apiErrors');
  const [loading, setLoading] = React.useState(false);

  const regenerate = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/lessons/${lessonId}/regenerate`, { method: 'POST' });
      if (res.ok) {
        toast({
          title: t('startedTitle'),
          description: t('startedDescription', { title: lessonTitle }),
          variant: 'success',
        });
        router.refresh();
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({
          title: t('failedTitle'),
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
    <Button
      variant="secondary"
      size="sm"
      loading={loading}
      disabled={disabled}
      onClick={regenerate}
      title={disabled ? t('alreadyGenerating') : undefined}
    >
      {!loading && <RefreshCw aria-hidden="true" />}
      {t('button')}
    </Button>
  );
}
