'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useToast,
} from '@/components/ui';
import { useTranslations } from 'next-intl';
import { errorMessage } from '@/lib/error-message';

/**
 * « Supprimer la partie » (2026-07-26) — supprime une leçon d'un cours déjà
 * généré (DELETE /api/lessons/[id]), avec confirmation. Complément de l'ajout
 * (AddLessonButton). Sur succès : refresh du Server Component (l'arbre se
 * met à jour sans la leçon).
 */
export interface DeleteLessonButtonProps {
  lessonId: string;
  lessonTitle: string;
  /** Leçon en cours de génération : suppression neutralisée. */
  disabled?: boolean;
}

export function DeleteLessonButton({ lessonId, lessonTitle, disabled = false }: DeleteLessonButtonProps) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useTranslations('course.deleteLesson');
  const tApiError = useTranslations('apiErrors');
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  const remove = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/lessons/${lessonId}`, { method: 'DELETE' });
      if (res.ok) {
        setOpen(false);
        toast({ title: t('deletedTitle'), description: t('deletedDescription', { title: lessonTitle }), variant: 'success' });
        router.refresh();
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({ title: t('failedTitle'), description: errorMessage(data, tApiError), variant: 'danger' });
      }
    } catch {
      toast({ title: t('failedTitle'), description: t('networkError'), variant: 'danger' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
        title={disabled ? t('alreadyGenerating') : undefined}
        className="text-danger hover:bg-danger/10"
      >
        <Trash2 aria-hidden="true" className="size-4" />
        {t('button')}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description', { title: lessonTitle })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={loading}>
              {t('cancel')}
            </Button>
            <Button type="button" variant="danger" loading={loading} onClick={remove}>
              <Trash2 aria-hidden="true" />
              {t('confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
