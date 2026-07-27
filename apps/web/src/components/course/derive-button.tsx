'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Copy } from 'lucide-react';
import { errorMessage } from '@/lib/error-message';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  useToast,
} from '@/components/ui';
import type { Difficulty, Locale } from './types';

/**
 * « Décliner ce cours » (P64) — ouvre un dialog permettant de créer une variante
 * du cours dans une autre langue (traduction + nouveau TTS/slides) ou à un autre
 * niveau de difficulté, en réutilisant le plan validé. POST /api/courses/[id]/derive
 * puis redirection vers le nouveau cours (en génération).
 */

const LOCALE_OPTIONS: { value: Locale; label: string }[] = [
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'العربية' },
];

const DIFFICULTY_OPTIONS: { value: Difficulty; labelKey: string }[] = [
  { value: 'beginner', labelKey: 'difficultyBeginner' },
  { value: 'intermediate', labelKey: 'difficultyIntermediate' },
  { value: 'advanced', labelKey: 'difficultyAdvanced' },
];

export interface DeriveButtonProps {
  courseId: string;
  /** Langue du cours source — valeur initiale du sélecteur de langue cible. */
  sourceLocale: Locale;
  /** Niveau du cours source — valeur initiale du sélecteur de niveau cible. */
  sourceDifficulty: Difficulty;
}

export function DeriveButton({ courseId, sourceLocale, sourceDifficulty }: DeriveButtonProps) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useTranslations('course.derive');
  const tApiError = useTranslations('apiErrors');
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [targetLocale, setTargetLocale] = React.useState<Locale>(sourceLocale);
  const [targetDifficulty, setTargetDifficulty] = React.useState<Difficulty>(sourceDifficulty);

  // La déclinaison doit changer au moins un axe (sinon = copie identique inutile).
  const unchanged = targetLocale === sourceLocale && targetDifficulty === sourceDifficulty;

  const submit = async () => {
    if (unchanged) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/courses/${courseId}/derive`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetLocale, targetDifficulty }),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as { id?: string } | null;
        toast({
          title: t('toastLaunchedTitle'),
          description: t('toastLaunchedDescription'),
          variant: 'success',
        });
        setOpen(false);
        if (data?.id) router.push(`/dashboard/courses/${data.id}`);
        else router.refresh();
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({
          title: t('toastFailedTitle'),
          description: errorMessage(data, tApiError),
          variant: 'danger',
        });
      }
    } catch {
      toast({
        title: t('toastNetworkTitle'),
        description: t('toastNetworkDescription'),
        variant: 'danger',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Copy aria-hidden="true" />
        {t('deriveThisCourse')}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('deriveThisCourse')}</DialogTitle>
            <DialogDescription>{t('dialogDescription')}</DialogDescription>
          </DialogHeader>

          <div className="mt-6 flex flex-col gap-4">
            <Select
              label={t('targetLanguageLabel')}
              value={targetLocale}
              onChange={(e) => setTargetLocale(e.target.value as Locale)}
            >
              {LOCALE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                  {opt.value === sourceLocale ? t('sourceSuffix') : ''}
                </option>
              ))}
            </Select>

            <Select
              label={t('targetDifficultyLabel')}
              value={targetDifficulty}
              onChange={(e) => setTargetDifficulty(e.target.value as Difficulty)}
            >
              {DIFFICULTY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                  {opt.value === sourceDifficulty ? t('sourceSuffix') : ''}
                </option>
              ))}
            </Select>

            {unchanged && (
              <p className="px-1 text-xs text-muted">
                {t('changeAxisHint')}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={loading}>
              {t('cancel')}
            </Button>
            <Button
              variant="gold"
              size="sm"
              loading={loading}
              disabled={unchanged}
              onClick={submit}
            >
              {t('submitButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
