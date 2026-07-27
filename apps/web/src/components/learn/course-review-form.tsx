'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Star } from 'lucide-react';
import { Button, Card, CardContent, Textarea, useToast } from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * Formulaire d'avis de l'apprenant INSCRIT (Prompt 205) — la seule source
 * d'avis réels du LMS interne, agrégée sur la page instructeur publique. Un
 * seul avis par (apprenant, cours) : renvoyer le formulaire met à jour l'avis
 * existant (POST /api/learn/[courseId]/review, upsert côté serveur).
 */

export interface CourseReviewFormProps {
  courseId: string;
  /** Avis déjà déposé par cet apprenant (chargé côté serveur), sinon null. */
  existing: { rating: number; comment: string } | null;
}

const RATINGS = [1, 2, 3, 4, 5] as const;

export function CourseReviewForm({ courseId, existing }: CourseReviewFormProps) {
  const t = useTranslations('courseReview');
  const { toast } = useToast();

  const [rating, setRating] = React.useState(existing?.rating ?? 0);
  const [comment, setComment] = React.useState(existing?.comment ?? '');
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(Boolean(existing));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (rating < 1 || saving) return;

    setSaving(true);
    try {
      const response = await fetch(`/api/learn/${courseId}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rating, comment: comment.trim() || undefined }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { code?: string } | null;
        toast({
          variant: 'danger',
          title: body?.code === 'rate_limited' ? t('rateLimited') : t('error'),
        });
        return;
      }

      setSaved(true);
      toast({ variant: 'success', title: t('saved') });
    } catch {
      toast({ variant: 'danger', title: t('error') });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-xl font-semibold text-foreground">{t('title')}</h2>
          <p className="text-sm text-muted">{t('description')}</p>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-foreground">{t('rating')}</legend>
            <div className="flex items-center gap-1">
              {RATINGS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRating(value)}
                  aria-pressed={rating === value}
                  aria-label={t('star', { count: value })}
                  className="rounded-sm p-1 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80"
                >
                  <Star
                    aria-hidden="true"
                    className={cn(
                      'size-6',
                      value <= rating
                        ? 'fill-accent-400 text-accent-400'
                        : 'text-border hover:text-muted',
                    )}
                  />
                </button>
              ))}
            </div>
          </fieldset>

          <Textarea
            label={t('comment')}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={600}
            rows={3}
            placeholder={t('placeholder')}
          />

          <Button type="submit" variant="primary" size="md" disabled={rating < 1 || saving} className="self-start">
            {saved ? t('update') : t('submit')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
