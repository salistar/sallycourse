'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Camera } from 'lucide-react';
import { Button, useToast } from '@/components/ui';
import { useTranslations } from 'next-intl';
import { errorMessage } from '@/lib/error-message';

/**
 * « Recapturer » (Lot 5, plan 2026-07-20, 5.3) — relance UNIQUEMENT la
 * capture automatique (Playwright) d'un TP, sans repasser par le LLM
 * (`POST /api/lessons/[id]/regenerate {mode:'render-only'}` → pour un TP,
 * `enqueueLessonMedia` enfile directement `screenshot-capture`). ÉCRASE
 * toutes les captures existantes, y compris tout remplacement manuel — action
 * exclusive avec l'édition manuelle par étape, jamais combinée.
 */
export interface RecaptureScreenshotsButtonProps {
  lessonId: string;
  lessonTitle: string;
  disabled?: boolean;
}

export function RecaptureScreenshotsButton({ lessonId, lessonTitle, disabled = false }: RecaptureScreenshotsButtonProps) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useTranslations('course.screenshotGallery');
  const tApiError = useTranslations('apiErrors');
  const [loading, setLoading] = React.useState(false);

  const recapture = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/lessons/${lessonId}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'render-only' }),
      });
      if (res.ok) {
        toast({
          title: t('recaptureStartedTitle'),
          description: t('recaptureStartedDescription', { title: lessonTitle }),
          variant: 'success',
        });
        router.refresh();
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({ title: t('failedTitle'), description: errorMessage(data, tApiError), variant: 'danger' });
      }
    } catch {
      toast({ title: t('networkErrorTitle'), description: t('networkErrorDescription'), variant: 'danger' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button variant="ghost" size="sm" loading={loading} disabled={disabled} onClick={() => void recapture()}>
      {!loading && <Camera aria-hidden="true" />}
      {t('recapture')}
    </Button>
  );
}
