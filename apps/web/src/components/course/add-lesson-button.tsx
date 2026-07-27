'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  Textarea,
  useToast,
} from '@/components/ui';
import { useTranslations } from 'next-intl';
import { errorMessage } from '@/lib/error-message';

/**
 * « Ajouter une leçon » (2026-07-26) — ajoute une vidéo/article/TP/quiz à un
 * cours DÉJÀ généré : Dialog (section cible, type, titre, brief optionnel)
 * → POST /api/courses/[id]/lessons → refresh. La nouvelle leçon apparaît en
 * fin de section avec le statut « génération en cours » ; le reste du cours
 * n'est pas touché.
 */
export interface AddLessonButtonProps {
  courseId: string;
  sections: { id: string; title: string }[];
  /** Cours en génération initiale : action neutralisée. */
  disabled?: boolean;
}

const LESSON_TYPES = ['video', 'article', 'tp', 'quiz'] as const;

export function AddLessonButton({ courseId, sections, disabled = false }: AddLessonButtonProps) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useTranslations('course.addLesson');
  const tApiError = useTranslations('apiErrors');
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [sectionId, setSectionId] = React.useState(sections[0]?.id ?? '');
  const [type, setType] = React.useState<(typeof LESSON_TYPES)[number]>('video');
  const [title, setTitle] = React.useState('');
  const [summary, setSummary] = React.useState('');

  const submit = async () => {
    if (title.trim().length < 3 || !sectionId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/courses/${courseId}/lessons`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sectionId,
          type,
          title: title.trim(),
          ...(summary.trim() ? { summary: summary.trim() } : {}),
        }),
      });
      if (res.ok) {
        toast({ title: t('startedTitle'), description: t('startedDescription', { title: title.trim() }), variant: 'success' });
        setOpen(false);
        setTitle('');
        setSummary('');
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

  if (sections.length === 0) return null;

  return (
    <>
      <Button variant="secondary" size="sm" disabled={disabled} onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" />
        {t('button')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('dialogTitle')}</DialogTitle>
            <DialogDescription>{t('dialogDescription')}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Select label={t('sectionLabel')} value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </Select>
            <Select
              label={t('typeLabel')}
              value={type}
              onChange={(e) => setType(e.target.value as (typeof LESSON_TYPES)[number])}
            >
              {LESSON_TYPES.map((tp) => (
                <option key={tp} value={tp}>
                  {t(`type_${tp}`)}
                </option>
              ))}
            </Select>
            <Input
              label={t('titleLabel')}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('titlePlaceholder')}
              maxLength={160}
            />
            <Textarea
              label={t('summaryLabel')}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder={t('summaryPlaceholder')}
              rows={3}
              maxLength={1000}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={loading}>
              {t('cancel')}
            </Button>
            <Button onClick={submit} loading={loading} disabled={title.trim().length < 3 || !sectionId}>
              {t('confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
