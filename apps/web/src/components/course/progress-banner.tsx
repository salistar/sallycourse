'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Card, CardContent, CardHeader, Progress } from '@/components/ui';
import { GenerationTimeline } from '@/components/motion';
import { useCourseProgress } from '@/hooks/use-course-progress';
import type { QueueName } from '@sallycourse/shared';
import { useTranslations } from 'next-intl';

/**
 * Bandeau « génération en cours » de la page détail — timeline des étapes du
 * pipeline alimentée par useCourseProgress (SSE) + avancement global et
 * dernier log. Les étapes reprennent les ids des queues BullMQ ; déclarées
 * localement pour ne rien embarquer du baril serveur dans le bundle client.
 */

interface PipelineStep {
  id: QueueName;
  labelKey: string;
  descriptionKey: string;
}

const PIPELINE_STEPS: readonly PipelineStep[] = [
  { id: 'outline-generation', labelKey: 'stepOutlineLabel', descriptionKey: 'stepOutlineDescription' },
  { id: 'content-generation', labelKey: 'stepContentLabel', descriptionKey: 'stepContentDescription' },
  { id: 'tts-generation', labelKey: 'stepTtsLabel', descriptionKey: 'stepTtsDescription' },
  { id: 'screenshot-capture', labelKey: 'stepScreenshotLabel', descriptionKey: 'stepScreenshotDescription' },
  { id: 'video-render', labelKey: 'stepVideoLabel', descriptionKey: 'stepVideoDescription' },
  { id: 'subtitle-generation', labelKey: 'stepSubtitleLabel', descriptionKey: 'stepSubtitleDescription' },
  { id: 'packaging', labelKey: 'stepPackagingLabel', descriptionKey: 'stepPackagingDescription' },
  { id: 'deployment', labelKey: 'stepDeploymentLabel', descriptionKey: 'stepDeploymentDescription' },
];

export interface ProgressBannerProps {
  courseId: string;
  className?: string;
}

/** Formate une durée (ms) en libellé court français (P73). */
function formatWaitLabel(
  ms: number,
  t: ReturnType<typeof useTranslations<'course.progress'>>,
): string {
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 1) return t('waitLessThanMinute');
  if (totalMinutes < 60) return t('waitMinutes', { minutes: totalMinutes });
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0
    ? t('waitHoursMinutes', { hours, minutes })
    : t('waitHours', { hours });
}

/** Intervalle de rafraîchissement de l'estimation de temps d'attente. */
const ESTIMATE_POLL_MS = 15_000;

export function ProgressBanner({ courseId, className }: ProgressBannerProps) {
  const router = useRouter();
  const t = useTranslations('course.progress');
  const { step, progress, logs, connected } = useCourseProgress(courseId);

  // Estimation du temps d'attente (P73) — rafraîchie tant que la génération
  // tourne ; masquée si la file est vide ou sans historique (estimatedWaitMs=0).
  const [waitMs, setWaitMs] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (!step) {
      setWaitMs(null);
      return;
    }
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const res = await fetch(
          `/api/courses/${encodeURIComponent(courseId)}/queue-estimate?step=${encodeURIComponent(step)}`,
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { estimatedWaitMs?: number };
        if (!cancelled) setWaitMs(data.estimatedWaitMs ?? 0);
      } catch {
        // Best-effort : l'estimation est un bonus UX, pas un garde-fou.
      }
    };
    void load();
    const timer = setInterval(load, ESTIMATE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [courseId, step]);

  // Estimation du pipeline complet + position en file + « prêt vers HH:mm »
  // (P134) — chargée tant que la génération n'est pas terminée.
  const [pipelineInfo, setPipelineInfo] = React.useState<{
    queuePosition: number;
    readyAtLabel: string;
  } | null>(null);

  const hasError = logs.some((log) => log.level === 'error');
  const stepIndex = Math.max(
    0,
    PIPELINE_STEPS.findIndex((s) => s.id === step),
  );
  // Avancement global : étapes franchies + fraction de l'étape courante.
  const overall = step
    ? Math.min(100, ((stepIndex + progress / 100) / PIPELINE_STEPS.length) * 100)
    : undefined;
  const lastLog = logs[logs.length - 1];

  const finished = stepIndex === PIPELINE_STEPS.length - 1 && progress >= 100 && !hasError;

  // Chargement de l'estimation du pipeline (P134) — arrêté une fois terminé
  // ou en erreur (plus la peine d'estimer un « prêt vers » qui ne viendra pas).
  React.useEffect(() => {
    if (finished || hasError) return;
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const res = await fetch(`/api/courses/${encodeURIComponent(courseId)}/pipeline-estimate`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          queuePosition?: number;
          readyAtLabel?: string;
        };
        if (!cancelled) {
          setPipelineInfo({
            queuePosition: data.queuePosition ?? 0,
            readyAtLabel: data.readyAtLabel ?? '',
          });
        }
      } catch {
        // Best-effort : l'estimation est un bonus UX, pas un garde-fou.
      }
    };
    void load();
    const timer = setInterval(load, ESTIMATE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [courseId, finished, hasError]);

  // Pipeline terminé : on rafraîchit le Server Component (statuts + assets frais).
  const refreshedRef = React.useRef(false);
  React.useEffect(() => {
    if (!finished || refreshedRef.current) return;
    refreshedRef.current = true;
    const timer = setTimeout(() => router.refresh(), 1_200);
    return () => clearTimeout(timer);
  }, [finished, router]);

  return (
    <Card wrapperClassName={className}>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-2xs font-semibold uppercase tracking-wide text-muted">
              {t('liveGeneration')}
            </p>
            <h2 className="mt-0.5 font-display text-lg font-semibold text-foreground">
              {hasError
                ? t('generationErrorTitle')
                : t('generationInProgressTitle')}
            </h2>
          </div>
          <Badge variant={hasError ? 'failed' : 'generating'}>
            {hasError ? t('badgeError') : connected ? t('badgeInProgress') : t('badgeReconnecting')}
          </Badge>
        </div>
        {/* Pas encore d'événement reçu → barre indéterminée. */}
        <Progress value={overall} label={t('overallProgress')} showLabel={overall !== undefined} />
        {/* Estimation du temps d'attente (P73) — masquée si file vide/sans historique. */}
        {!finished && !hasError && waitMs !== null && waitMs > 0 && (
          <p className="text-2xs text-muted">
            {t('estimatedWait', { label: formatWaitLabel(waitMs, t) })}
          </p>
        )}
        {/* File d'attente + estimation globale du pipeline (P134). */}
        {!finished && !hasError && pipelineInfo && (
          <p className="text-2xs text-muted">
            {pipelineInfo.queuePosition > 0 && (
              <>
                {t('queuePosition', { count: pipelineInfo.queuePosition })}
                {pipelineInfo.readyAtLabel ? ' — ' : ''}
              </>
            )}
            {pipelineInfo.readyAtLabel && t('readyAt', { label: pipelineInfo.readyAtLabel })}
          </p>
        )}
      </CardHeader>

      <CardContent className="grid gap-6 lg:grid-cols-[minmax(240px,300px)_1fr]">
        <GenerationTimeline
          steps={PIPELINE_STEPS.map((s) => ({ id: s.id, label: t(s.labelKey), description: t(s.descriptionKey) }))}
          currentIndex={stepIndex}
          status={hasError ? 'failed' : finished ? 'done' : 'running'}
        />
        <div className="flex flex-col gap-2">
          <p className="text-2xs font-semibold uppercase tracking-wide text-muted">{t('lastActivity')}</p>
          {lastLog ? (
            <p className="rounded-md border border-border bg-surface-subtle p-3 font-mono text-xs leading-relaxed text-foreground/90">
              {lastLog.msg}
            </p>
          ) : (
            <p className="text-sm text-muted">
              {t('waitingFirstEvents')}
            </p>
          )}
          {logs.length > 1 && (
            <p className="text-2xs tabular-nums text-muted">{t('eventsReceived', { count: logs.length })}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
