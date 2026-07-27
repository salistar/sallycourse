'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { XCircle } from 'lucide-react';
import { Button, useToast } from '@/components/ui';
import { useTranslations } from 'next-intl';
import { errorMessage } from '@/lib/error-message';

/**
 * « Annuler la génération » (P73) — visible pendant generating/outline-review.
 * Demande confirmation, POST /api/courses/[id]/cancel (le worker détecte le
 * statut 'cancelled' et arrête proprement), puis rafraîchit la page.
 * La route existait sans AUCUN bouton (audit connectivité 2026-07-17).
 */
export function CancelGenerationButton({ courseId }: { courseId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useTranslations('course.cancelGen');
  const tApiError = useTranslations('apiErrors');
  const [busy, setBusy] = React.useState(false);

  const cancel = async () => {
    if (!window.confirm(t('confirmCancel'))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/courses/${courseId}/cancel`, { method: 'POST' });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        toast({ variant: 'danger', title: t('cancelFailedTitle'), description: errorMessage(data, tApiError) });
        return;
      }
      toast({ variant: 'success', title: t('cancelledTitle') });
      router.refresh();
    } catch {
      toast({ variant: 'danger', title: t('networkErrorTitle'), description: t('networkErrorDesc') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="ghost" size="sm" loading={busy} onClick={() => void cancel()} className="text-danger hover:bg-danger/10">
      {!busy && <XCircle aria-hidden="true" />}
      {t('cancelButton')}
    </Button>
  );
}
