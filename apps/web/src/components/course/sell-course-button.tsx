'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Store } from 'lucide-react';
import { errorMessage } from '@/lib/error-message';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea,
  useToast,
} from '@/components/ui';

/**
 * « Vendre sur la marketplace » (P147) — met le cours en vente (prix USD,
 * licence « copie intégrale »). Formulaire dans un Dialog du design system
 * (les window.prompt natifs, hors charte, ont été remplacés — audit design).
 */
export function SellCourseButton({ courseId }: { courseId: string }) {
  const { toast } = useToast();
  const t = useTranslations('course.sell');
  const tApiError = useTranslations('apiErrors');
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [price, setPrice] = React.useState('19.99');
  const [description, setDescription] = React.useState('');

  const sell = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = Number.parseFloat(price.replace(',', '.'));
    if (!Number.isFinite(value) || value < 0) {
      toast({ variant: 'danger', title: t('invalidPrice') });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/marketplace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId,
          priceCents: Math.round(value * 100),
          licenseType: 'course-copy',
          description: description.trim(),
        }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        toast({ variant: 'danger', title: t('listingFailed'), description: errorMessage(data, tApiError) });
        return;
      }
      toast({ variant: 'success', title: t('listed'), description: t('listedVisible') });
      setOpen(false);
    } catch {
      toast({ variant: 'danger', title: t('networkError'), description: t('serverUnreachable') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Store aria-hidden="true" />
        {t('sell')}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={sell} className="flex flex-col gap-5">
            <DialogHeader>
              <DialogTitle>{t('dialogTitle')}</DialogTitle>
              <DialogDescription>{t('dialogDescription')}</DialogDescription>
            </DialogHeader>
            <Input
              label={t('priceLabel')}
              type="number"
              min={0}
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              required
            />
            <Textarea
              label={t('descriptionLabel')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={500}
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                {t('cancel')}
              </Button>
              <Button type="submit" loading={busy}>
                {t('submit')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
