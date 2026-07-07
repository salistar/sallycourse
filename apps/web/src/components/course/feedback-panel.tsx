'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, MessageSquareText, Sparkles, Star } from 'lucide-react';
import { Badge, Button, useToast } from '@/components/ui';
import { cn } from '@/lib/cn';
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
  { variant: 'ready' | 'failed' | 'draft'; label: string }
> = {
  positive: { variant: 'ready', label: 'Positif' },
  neutral: { variant: 'draft', label: 'Neutre' },
  negative: { variant: 'failed', label: 'Négatif' },
};

export function FeedbackPanel({ courseId, feedback, reviewable }: FeedbackPanelProps) {
  const router = useRouter();
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
          title: 'Analyse lancée',
          description: 'Les retours étudiants sont en cours d’analyse, revenez dans un instant.',
          variant: 'success',
        });
        setOpen(true);
        router.refresh();
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({
          title: 'Analyse impossible',
          description: data?.error ?? 'Une erreur est survenue, réessayez plus tard.',
          variant: 'danger',
        });
      }
    } catch {
      toast({
        title: 'Erreur réseau',
        description: 'Impossible de joindre le serveur, vérifiez votre connexion.',
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
          title: 'Régénération lancée',
          description: 'La leçon repart en production avec cette amélioration.',
          variant: 'success',
        });
        router.refresh();
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({
          title: 'Application impossible',
          description: data?.error ?? 'Une erreur est survenue, réessayez plus tard.',
          variant: 'danger',
        });
      }
    } catch {
      toast({
        title: 'Erreur réseau',
        description: 'Impossible de joindre le serveur, vérifiez votre connexion.',
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
            <span className="block font-medium text-foreground">Retours étudiants</span>
            <span className="block text-xs text-muted">
              {hasFeedback ? (
                <>
                  {feedback!.reviewCount} avis · note moyenne {feedback!.averageRating.toFixed(1)}/5 · analysé le{' '}
                  {new Date(feedback!.generatedAt).toLocaleDateString('fr-FR', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </>
              ) : (
                'Aucune analyse pour le moment.'
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
              Récupère les avis publiés (Udemy) et les analyse par IA pour en extraire les thèmes récurrents
              et des pistes d'amélioration ciblées.
            </p>
            <Button variant="secondary" size="sm" loading={analyzing} onClick={runAnalysis}>
              {!analyzing && <Sparkles aria-hidden="true" />}
              Analyser les retours
            </Button>
          </div>

          {hasFeedback && feedback!.themes.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Thèmes récurrents</h3>
              <ul className="flex flex-col gap-2">
                {feedback!.themes.map((theme, i) => (
                  <li key={`${theme.label}-${i}`} className="rounded-md border border-border bg-surface-subtle p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={SENTIMENT_BADGE[theme.sentiment].variant} hideDot>
                        {SENTIMENT_BADGE[theme.sentiment].label}
                      </Badge>
                      <span className="text-sm font-medium text-foreground">{theme.label}</span>
                      <span className="inline-flex items-center gap-1 text-xs text-muted">
                        <Star className="size-3" aria-hidden="true" />
                        {theme.count} avis
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
                Suggestions d'amélioration
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
                            Leçon : <span className="font-normal text-muted">{suggestion.lessonRef}</span>
                          </>
                        ) : (
                          'Amélioration générale du cours'
                        )}
                      </p>
                      <p className="mt-1 text-sm text-foreground">{suggestion.action}</p>
                      <p className="mt-1 text-xs text-muted">{suggestion.rationale}</p>
                    </div>
                    <span className="shrink-0" title={!suggestion.lessonId ? 'Suggestion globale : aucune leçon à régénérer automatiquement' : undefined}>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={applyingIndex === i}
                        disabled={!suggestion.lessonId}
                        onClick={() =>
                          suggestion.lessonId && applySuggestion(i, suggestion.lessonId, suggestion.action)
                        }
                      >
                        Appliquer
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
                ? "Aucun thème ni suggestion n'a pu être extrait de ces avis."
                : "Aucun avis disponible pour ce cours pour le moment."}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
