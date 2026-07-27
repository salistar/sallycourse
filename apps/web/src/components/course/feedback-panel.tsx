'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations, useFormatter } from 'next-intl';
import { ChevronDown, MessageSquareText, Sparkles, Star } from 'lucide-react';
import { Badge, Button, useToast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/error-message';
import type { ReviewFeedbackView } from './types';

/**
 * Section « Retours étudiants » (Prompt 62) — affiche les thèmes récurrents
 * extraits des avis (Udemy, mock) et les suggestions d'amélioration ciblées.
 * « Analyser les retours » enfile le job d'analyse (worker) ; « Appliquer »
 * régénère la leçon visée avec l'instruction (mécanisme de régénération
 * existant), ou reste manuelle si la suggestion est globale (aucune leçon
 * résolue) — on ne devine pas quelle leçon corriger.
 */

export interface FeedbackPanelProps {
  courseId: string;
  feedback: ReviewFeedbackView | null | undefined;
  /** Le cours doit être publié/prêt pour avoir des avis à analyser. */
  reviewable: boolean;
}

const SENTIMENT_BADGE: Record<
  ReviewFeedbackView['themes'][number]['sentiment'],
  { variant: 'ready' | 'failed' | 'draft'; labelKey: string }
> = {
  positive: { variant: 'ready', labelKey: 'sentimentPositive' },
  neutral: { variant: 'draft', labelKey: 'sentimentNeutral' },
  negative: { variant: 'failed', labelKey: 'sentimentNegative' },
};

export function FeedbackPanel({ courseId, feedback, reviewable }: FeedbackPanelProps) {
  const router = useRouter();
  const t = useTranslations('course.feedback');
  const tApiError = useTranslations('apiErrors');
  const format = useFormatter();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(Boolean(feedback && feedback.suggestions.length > 0));
  const [analyzing, setAnalyzing] = React.useState(false);
  const [applyingIndex, setApplyingIndex] = React.useState<number | null>(null);
  const contentId = React.useId();

  if (!reviewable) return null;

  const runAnalysis = async () => {
    setAnalyzing(true);
    try {
      const res = await fetch(`/api/courses/${courseId}/reviews/analyze`, { method: 'POST' });
      if (res.ok) {
        toast({
          title: t('analysisStartedTitle'),
          description: t('analysisStartedDesc'),
          variant: 'success',
        });
        setOpen(true);
        router.refresh();
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({
          title: t('analysisFailedTitle'),
          description: errorMessage(data, tApiError),
          variant: 'danger',
        });
      }
    } catch {
      toast({
        title: t('networkErrorTitle'),
        description: t('networkErrorDesc'),
        variant: 'danger',
      });
    } finally {
      setAnalyzing(false);
    }
  };

  const applySuggestion = async (index: number, lessonId: string, action: string) => {
    setApplyingIndex(index);
    try {
      const res = await fetch(`/api/lessons/${lessonId}/apply-suggestion`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instruction: action }),
      });
      if (res.ok) {
        toast({
          title: t('regenStartedTitle'),
          description: t('regenStartedDesc'),
          variant: 'success',
        });
        router.refresh();
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({
          title: t('applyFailedTitle'),
          description: errorMessage(data, tApiError),
          variant: 'danger',
        });
      }
    } catch {
      toast({
        title: t('networkErrorTitle'),
        description: t('networkErrorDesc'),
        variant: 'danger',
      });
    } finally {
      setApplyingIndex(null);
    }
  };

  const hasFeedback = Boolean(feedback);

  return (
    <section className="rounded-lg border border-border bg-surface shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={contentId}
        className="flex w-full items-center justify-between gap-3 rounded-lg p-4 text-left transition-colors duration-fast hover:bg-muted/5"
      >
        <span className="flex min-w-0 items-center gap-3">
          <MessageSquareText className="size-5 shrink-0 text-muted" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block font-medium text-foreground">{t('heading')}</span>
            <span className="block text-xs text-muted">
              {hasFeedback ? (
                t('summary', {
                  count: feedback!.reviewCount,
                  rating: feedback!.averageRating.toFixed(1),
                  date: format.dateTime(new Date(feedback!.generatedAt), {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  }),
                })
              ) : (
                t('noAnalysis')
              )}
            </span>
          </span>
        </span>
        <ChevronDown
          className={cn('size-5 shrink-0 text-muted transition-transform duration-base', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div id={contentId} className="flex flex-col gap-6 border-t border-border p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted">
              {t('intro')}
            </p>
            <Button variant="secondary" size="sm" loading={analyzing} onClick={runAnalysis}>
              {!analyzing && <Sparkles aria-hidden="true" />}
              {t('analyzeButton')}
            </Button>
          </div>

          {hasFeedback && feedback!.themes.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{t('themesHeading')}</h3>
              <ul className="flex flex-col gap-2">
                {feedback!.themes.map((theme, i) => (
                  <li key={`${theme.label}-${i}`} className="rounded-md border border-border bg-surface-subtle p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={SENTIMENT_BADGE[theme.sentiment].variant} hideDot>
                        {t(SENTIMENT_BADGE[theme.sentiment].labelKey)}
                      </Badge>
                      <span className="text-sm font-medium text-foreground">{theme.label}</span>
                      <span className="inline-flex items-center gap-1 text-xs text-muted">
                        <Star className="size-3" aria-hidden="true" />
                        {t('reviewsCount', { count: theme.count })}
                      </span>
                    </div>
                    {theme.quotes.length > 0 && (
                      <ul className="mt-2 flex flex-col gap-1">
                        {theme.quotes.map((quote, qi) => (
                          <li key={qi} className="text-sm italic text-muted">
                            « {quote} »
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hasFeedback && feedback!.suggestions.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                {t('suggestionsHeading')}
              </h3>
              <ul className="flex flex-col gap-2">
                {feedback!.suggestions.map((suggestion, i) => (
                  <li
                    key={i}
                    className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {suggestion.lessonRef ? (
                          <>
                            {t('lessonLabel')} <span className="font-normal text-muted">{suggestion.lessonRef}</span>
                          </>
                        ) : (
                          t('generalImprovement')
                        )}
                      </p>
                      <p className="mt-1 text-sm text-foreground">{suggestion.action}</p>
                      <p className="mt-1 text-xs text-muted">{suggestion.rationale}</p>
                    </div>
                    <span className="shrink-0" title={!suggestion.lessonId ? t('globalSuggestionHint') : undefined}>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={applyingIndex === i}
                        disabled={!suggestion.lessonId}
                        onClick={() =>
                          suggestion.lessonId && applySuggestion(i, suggestion.lessonId, suggestion.action)
                        }
                      >
                        {t('applyButton')}
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hasFeedback && feedback!.themes.length === 0 && feedback!.suggestions.length === 0 && (
            <p className="text-sm text-muted">
              {feedback!.reviewCount > 0
                ? t('noThemesExtracted')
                : t('noReviewsYet')}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
