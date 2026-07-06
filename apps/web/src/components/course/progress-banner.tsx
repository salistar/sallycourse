'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Card, CardContent, CardHeader, Progress } from '@/components/ui';
import { GenerationTimeline, type GenerationStep } from '@/components/motion';
import { useCourseProgress } from '@/hooks/use-course-progress';
import type { QueueName } from '@sallycourse/shared';

/**
 * Bandeau « génération en cours » de la page détail — timeline des étapes du
 * pipeline alimentée par useCourseProgress (SSE) + avancement global et
 * dernier log. Les étapes reprennent les ids des queues BullMQ ; déclarées
 * localement pour ne rien embarquer du baril serveur dans le bundle client.
 */

interface PipelineStep extends GenerationStep {
  id: QueueName;
}

const PIPELINE_STEPS: readonly PipelineStep[] = [
  { id: 'outline-generation', label: 'Plan du cours', description: 'Sections et leçons' },
  { id: 'content-generation', label: 'Rédaction du contenu', description: 'Scripts, articles et TP' },
  { id: 'tts-generation', label: 'Voix off', description: 'Synthèse vocale des scripts' },
  { id: 'screenshot-capture', label: "Captures d'écran", description: 'Illustrations des démos' },
  { id: 'video-render', label: 'Rendu vidéo', description: 'Montage des leçons' },
  { id: 'subtitle-generation', label: 'Sous-titres', description: 'Pistes SRT / VTT' },
  { id: 'packaging', label: 'Packaging', description: 'Assemblage du pack' },
  { id: 'deployment', label: 'Déploiement', description: 'Publication plateformes' },
];

export interface ProgressBannerProps {
  courseId: string;
  className?: string;
}

export function ProgressBanner({ courseId, className }: ProgressBannerProps) {
  const router = useRouter();
  const { step, progress, logs, connected } = useCourseProgress(courseId);

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
              Génération en direct
            </p>
            <h2 className="mt-0.5 font-display text-lg font-semibold text-foreground">
              {hasError
                ? 'Un incident est survenu pendant la génération'
                : 'Votre cours est en cours de production'}
            </h2>
          </div>
          <Badge variant={hasError ? 'failed' : 'generating'}>
            {hasError ? 'Incident' : connected ? 'En cours' : 'Reconnexion…'}
          </Badge>
        </div>
        {/* Pas encore d'événement reçu → barre indéterminée. */}
        <Progress value={overall} label="Avancement global" showLabel={overall !== undefined} />
      </CardHeader>

      <CardContent className="grid gap-6 lg:grid-cols-[minmax(240px,300px)_1fr]">
        <GenerationTimeline
          steps={PIPELINE_STEPS.map((s) => ({ ...s }))}
          currentIndex={stepIndex}
          status={hasError ? 'failed' : finished ? 'done' : 'running'}
        />
        <div className="flex flex-col gap-2">
          <p className="text-2xs font-semibold uppercase tracking-wide text-muted">Dernière activité</p>
          {lastLog ? (
            <p className="rounded-md border border-border bg-surface-subtle p-3 font-mono text-xs leading-relaxed text-foreground/90">
              {lastLog.msg}
            </p>
          ) : (
            <p className="text-sm text-muted">
              En attente des premiers événements du worker de génération…
            </p>
          )}
          {logs.length > 1 && (
            <p className="text-2xs tabular-nums text-muted">{logs.length} événements reçus</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
