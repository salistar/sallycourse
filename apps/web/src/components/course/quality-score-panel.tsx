'use client';

import * as React from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import { ChevronDown, GraduationCap } from 'lucide-react';
import { Badge, type BadgeProps } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { QualityScoreView } from './types';

/**
 * Score de qualité pédagogique (Prompt 94) — badge de synthèse + détail de la
 * rubrique (clarté/progression/exemples/engagement) et feedback actionnable.
 * Repliée par défaut quand le score est bon, dépliée quand il est sous le
 * seuil de déploiement (l'utilisateur doit voir pourquoi).
 */

/** Seuil d'affichage aligné sur QUALITY_SCORE.MIN_DEPLOY_THRESHOLD (packages/shared). */
const QUALITY_THRESHOLD = 60;

const RUBRIC_LABELS: Record<keyof QualityScoreView['rubric'], string> = {
  clarity: 'rubricClarity',
  progression: 'rubricProgression',
  examples: 'rubricExamples',
  engagement: 'rubricEngagement',
};

/** Score → variante Badge + libellé, alignés sur le seuil de déploiement. */
function scoreBadge(score: number): { variant: NonNullable<BadgeProps['variant']>; labelKey: string } {
  if (score >= 80) return { variant: 'published', labelKey: 'badgeExcellent' };
  if (score >= QUALITY_THRESHOLD) return { variant: 'ready', labelKey: 'badgeGood' };
  return { variant: 'failed', labelKey: 'badgeBelowThreshold' };
}

export interface QualityScorePanelProps {
  qualityScore: QualityScoreView | null | undefined;
}

export function QualityScorePanel({ qualityScore }: QualityScorePanelProps) {
  const [open, setOpen] = React.useState(
    Boolean(qualityScore) && qualityScore!.score < QUALITY_THRESHOLD,
  );
  const contentId = React.useId();
  const t = useTranslations('course.quality');
  const format = useFormatter();

  if (!qualityScore) return null;

  const badge = scoreBadge(qualityScore.score);
  const evaluatedAt = new Date(qualityScore.evaluatedAt);
  const rubricEntries = Object.entries(qualityScore.rubric) as [keyof QualityScoreView['rubric'], number][];

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
          <GraduationCap className="size-5 shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">{t('title')}</span>
              <Badge variant={badge.variant} hideDot className="text-2xs">
                {t(badge.labelKey, { score: qualityScore.score })}
              </Badge>
            </span>
            <span className="block text-xs text-muted">
              {t('evaluatedOn', {
                date: format.dateTime(evaluatedAt, { day: 'numeric', month: 'long', year: 'numeric' }),
              })}
            </span>
          </span>
        </span>
        <ChevronDown
          className={cn(
            'size-5 shrink-0 text-muted transition-transform duration-base',
            open && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div id={contentId} className="flex flex-col gap-4 border-t border-border p-4">
          {/* ── Rubrique détaillée ────────────────────────────────── */}
          <div className="grid gap-3 sm:grid-cols-2">
            {rubricEntries.map(([key, value]) => (
              <div key={key} className="rounded-md border border-border bg-background p-3">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium text-foreground">{t(RUBRIC_LABELS[key])}</span>
                  <span className="tabular-nums text-muted">{value}/25</span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-subtle">
                  <div
                    className={cn(
                      'h-full rounded-full',
                      value >= 20 ? 'bg-success' : value >= 12 ? 'bg-accent' : 'bg-danger',
                    )}
                    style={{ width: `${Math.min(100, Math.max(0, (value / 25) * 100))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* ── Feedback actionnable ──────────────────────────────── */}
          {qualityScore.feedback.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {qualityScore.feedback.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-muted">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-muted" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          )}

          {qualityScore.score < QUALITY_THRESHOLD && (
            <p className="rounded-md border border-danger/40 bg-danger/5 p-3 text-xs text-danger">
              {t('belowThresholdWarning', { threshold: QUALITY_THRESHOLD })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
