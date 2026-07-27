'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Stethoscope } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, useToast } from '@/components/ui';
import { useTranslations } from 'next-intl';
import { errorMessage } from '@/lib/error-message';

/**
 * Panneau « Réviser le cours » (2026-07-26) : lance la révision automatique
 * (POST /api/courses/[id]/review) — le worker détecte et répare leçons en
 * échec, images de slides mal générées, audio défectueux et captures TP
 * dégradées. Affiche le dernier rapport (Course.reviewReport).
 */

export interface ReviewReportView {
  startedAt: string;
  finishedAt: string;
  lessonsScanned: number;
  actions: { lessonId: string; lessonTitle: string; type: string; reason: string }[];
}

export interface ReviewPanelProps {
  courseId: string;
  report?: ReviewReportView | null;
  /** Cours pas encore prêt : action neutralisée. */
  disabled?: boolean;
}

const ACTION_BADGE: Record<string, string> = {
  'regenerate-lesson': 'actionRegenerateLesson',
  'regenerate-image': 'actionRegenerateImage',
  'repair-audio': 'actionRepairAudio',
  'recapture-tp': 'actionRecaptureTp',
};

export function ReviewPanel({ courseId, report, disabled = false }: ReviewPanelProps) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useTranslations('course.review');
  const tApiError = useTranslations('apiErrors');
  const [loading, setLoading] = React.useState(false);

  const start = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/courses/${courseId}/review`, { method: 'POST' });
      if (res.ok) {
        toast({ title: t('startedTitle'), description: t('startedDescription'), variant: 'success' });
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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Stethoscope aria-hidden="true" className="size-4" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div>
          <Button size="sm" onClick={start} loading={loading} disabled={disabled}>
            {t('start')}
          </Button>
        </div>
        {report && (
          <div className="rounded-md border border-border bg-surface-subtle/50 p-3 text-xs">
            <p className="mb-2 text-muted">
              {t('lastReport', {
                date: new Date(report.finishedAt).toLocaleString(),
                lessons: report.lessonsScanned,
              })}
            </p>
            {report.actions.length === 0 ? (
              <p className="text-success">{t('noIssue')}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {report.actions.map((a, i) => (
                  <li key={`${a.lessonId}-${a.type}-${i}`} className="flex flex-wrap items-center gap-2">
                    <Badge variant="draft">{t(ACTION_BADGE[a.type] ?? 'actionOther')}</Badge>
                    <span className="max-w-56 truncate text-foreground" title={a.lessonTitle}>
                      {a.lessonTitle}
                    </span>
                    <span className="text-muted">{a.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
