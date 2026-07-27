'use client';

import * as React from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { CheckCircle2, ChevronDown, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { QaReportView } from './types';

/**
 * Rapport de contrôle qualité (Prompt 26) — section repliable affichant le
 * verdict global (succès / échec) puis la liste des checks avec une icône
 * success/danger et le détail. Repliée par défaut quand le QA passe, dépliée
 * quand il échoue (l'utilisateur doit voir les problèmes bloquant la publication).
 */

/** Libellés lisibles des codes de check (fallback : le code brut). */
const CHECK_LABELS: Record<string, string> = {
  'video-duration': 'checks.videoDuration',
  'section-count': 'checks.sectionCount',
  'video-playable': 'checks.videoPlayable',
  'article-placeholders': 'checks.articlePlaceholders',
  'quiz-valid': 'checks.quizValid',
  'lessons-complete': 'checks.lessonsComplete',
};

export interface QaReportPanelProps {
  report: QaReportView;
}

export function QaReportPanel({ report }: QaReportPanelProps) {
  const t = useTranslations('course.qa');
  const format = useFormatter();
  // Ouvert d'office si le contrôle échoue : les problèmes doivent être visibles.
  const [open, setOpen] = React.useState(!report.passed);
  const contentId = React.useId();

  const failedCount = report.checks.filter((c) => !c.ok).length;
  const ranAt = new Date(report.ranAt);

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
          {report.passed ? (
            <ShieldCheck className="size-5 shrink-0 text-success" aria-hidden="true" />
          ) : (
            <ShieldAlert className="size-5 shrink-0 text-danger" aria-hidden="true" />
          )}
          <span className="min-w-0">
            <span className="block font-medium text-foreground">
              {t('title')}{' '}
              {report.passed ? (
                <span className="text-success">{t('passed')}</span>
              ) : (
                <span className="text-danger">
                  {t('failed', { count: failedCount })}
                </span>
              )}
            </span>
            <span className="block text-xs text-muted">
              {t('ranAt', {
                date: format.dateTime(ranAt, { day: 'numeric', month: 'long', year: 'numeric' }),
                time: format.dateTime(ranAt, { hour: '2-digit', minute: '2-digit' }),
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
        <ul id={contentId} className="flex flex-col gap-2 border-t border-border p-4">
          {report.checks.map((check) => (
            <li key={check.code} className="flex items-start gap-3">
              {check.ok ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              ) : (
                <XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
              )}
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">
                  {CHECK_LABELS[check.code] ? t(CHECK_LABELS[check.code]) : check.code}
                </span>
                <span
                  className={cn('block text-sm', check.ok ? 'text-muted' : 'text-danger')}
                >
                  {check.detail}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
