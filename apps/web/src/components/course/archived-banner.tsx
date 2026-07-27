'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Archive } from 'lucide-react';
import { Button, useToast } from '@/components/ui';
import { useTranslations } from 'next-intl';
import { errorMessage } from '@/lib/error-message';

/**
 * Bandeau « Cours archivé » (rétention P79) sur la page détail : un cours
 * inactif 90+ jours est archivé (médias purgés). Il reste consultable mais ses
 * assets sont absents ; ce bandeau l'explique et propose de le RÉACTIVER
 * (POST /api/courses/[id]/reactivate — ré-enqueue depuis Lesson.script, sans
 * rappel LLM). Jusqu'ici, l'unique point d'entrée était la carte du dashboard.
 */
export function ArchivedBanner({ courseId }: { courseId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const t = useTranslations('course.archived');
  const tApiError = useTranslations('apiErrors');

  const reactivate = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/courses/${courseId}/reactivate`, { method: 'POST' });
      if (res.ok) {
        toast({
          title: t('reactivationStartedTitle'),
          description: t('reactivationStartedDescription'),
          variant: 'success',
        });
        router.refresh();
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({ title: t('reactivationFailedTitle'), description: errorMessage(data, tApiError), variant: 'danger' });
      }
    } catch {
      toast({ title: t('networkErrorTitle'), description: t('serverUnreachable'), variant: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4">
      <div className="flex items-start gap-3">
        <Archive className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-semibold text-foreground">{t('title')}</p>
          <p className="text-xs text-muted">{t('description')}</p>
        </div>
      </div>
      <Button variant="secondary" size="sm" loading={busy} onClick={() => void reactivate()}>
        <Archive aria-hidden="true" />
        {t('reactivateButton')}
      </Button>
    </div>
  );
}
