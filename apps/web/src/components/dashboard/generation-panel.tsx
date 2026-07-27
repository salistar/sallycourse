'use client';

import * as React from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import { AnimatePresence, motion } from 'framer-motion';
import { TerminalSquare, MonitorPlay } from 'lucide-react';
import { Badge, Card, CardContent, CardHeader, Progress } from '@/components/ui';
import {
  GenerationTimeline,
  transitions,
  usePrefersReducedMotion,
  type GenerationStep,
  type GenerationTimelineStatus,
} from '@/components/motion';
import { cn } from '@/lib/cn';
import { useCourseProgress } from '@/hooks/use-course-progress';
import type { SlidePreview } from './mock-data';

/**
 * Panneau « génération en direct » — trois volets synchronisés sur le flux
 * SSE réel du cours (useCourseProgress → /api/courses/[id]/progress) :
 *  1. timeline des étapes du pipeline (GenerationTimeline, motion D4) ;
 *  2. terminal des logs du worker avec auto-scroll ;
 *  3. aperçu synthétique de la slide en cours de rendu.
 */

/* ------------------------------------------------------------------ */
/* Étapes du pipeline (alignées sur QUEUES de @sallycourse/shared)      */
/* ------------------------------------------------------------------ */

// NB : baril @sallycourse/shared non importable côté client (node:crypto,
// @aws-sdk) — les noms de queues sont donc répliqués ici via `key`.
interface PipelineStepDef {
  id: string;
  /** Fragment identifiant l'étape dans ProgressEvent.step / GenerationJob.step. */
  key: string;
  /** Clés i18n du libellé et de la description (résolues au rendu). */
  labelKey: string;
  descriptionKey: string;
}

const PIPELINE_STEPS: PipelineStepDef[] = [
  { id: 'outline', key: 'outline', labelKey: 'steps.outline.label', descriptionKey: 'steps.outline.description' },
  { id: 'content', key: 'content', labelKey: 'steps.content.label', descriptionKey: 'steps.content.description' },
  { id: 'tts', key: 'tts', labelKey: 'steps.tts.label', descriptionKey: 'steps.tts.description' },
  { id: 'screenshot', key: 'screenshot', labelKey: 'steps.screenshot.label', descriptionKey: 'steps.screenshot.description' },
  { id: 'video', key: 'video', labelKey: 'steps.video.label', descriptionKey: 'steps.video.description' },
  { id: 'subtitle', key: 'subtitle', labelKey: 'steps.subtitle.label', descriptionKey: 'steps.subtitle.description' },
  { id: 'packaging', key: 'packaging', labelKey: 'steps.packaging.label', descriptionKey: 'steps.packaging.description' },
  { id: 'deployment', key: 'deploy', labelKey: 'steps.deployment.label', descriptionKey: 'steps.deployment.description' },
];

/** Index de l'étape courante d'après son nom (tolérant : queue ou libellé court). */
function resolveStepIndex(step: string | null): number {
  if (!step) return 0;
  const index = PIPELINE_STEPS.findIndex((s) => step.includes(s.key));
  return index === -1 ? 0 : index;
}

/* ------------------------------------------------------------------ */
/* Terminal de logs                                                     */
/* ------------------------------------------------------------------ */

type LineLevel = 'info' | 'warn' | 'error' | 'muted';

interface TerminalLine {
  time: string;
  level: LineLevel;
  text: string;
}

const LOG_TEXT_STYLES: Record<LineLevel, string> = {
  info: 'text-neutral-300',
  warn: 'text-warning',
  error: 'text-danger',
  muted: 'text-neutral-500 italic',
};

/* Horodatage des logs : formaté via useFormatter (locale active de l'app). */

/** Terminal stylé — chrome macOS discret, fond quasi noir, fonte mono. */
function LogTerminal({ lines }: { lines: TerminalLine[] }) {
  const t = useTranslations('dashboard.generationPanel');
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();

  // Auto-scroll : le terminal suit toujours la dernière ligne.
  React.useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
  }, [lines.length, reduced]);

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-neutral-950 shadow-sm">
      {/* Barre de titre du terminal */}
      <div className="flex items-center gap-2 border-b border-border/60 px-3.5 py-2.5">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-danger/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-warning/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-success/80" />
        </span>
        <span className="ms-1 flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide text-neutral-400">
          <TerminalSquare className="size-3.5" aria-hidden="true" />
          {t('terminalTitle')}
        </span>
      </div>

      {/* Flux de logs — aria-live poli pour les lecteurs d'écran */}
      <div
        ref={scrollRef}
        aria-live="polite"
        aria-label={t('logAriaLabel')}
        dir="ltr"
        className="h-56 overflow-y-auto p-3.5 font-mono text-xs leading-relaxed"
      >
        {lines.map((line, index) => (
          <motion.p
            key={`${line.time}-${index}`}
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={transitions.enter}
            className="flex gap-2.5"
          >
            <span className="shrink-0 tabular-nums text-neutral-600">{line.time}</span>
            <span className={LOG_TEXT_STYLES[line.level]}>{line.text}</span>
          </motion.p>
        ))}
        {/* Curseur qui clignote — le worker écrit encore */}
        <p className="flex gap-2.5" aria-hidden="true">
          <span className="shrink-0 text-neutral-600">&nbsp;</span>
          <span className="inline-block h-3.5 w-2 animate-pulse bg-accent-400/80" />
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Aperçu de slide                                                      */
/* ------------------------------------------------------------------ */

/** Aperçu de la slide en cours — cadre 16:9 façon rendu vidéo. */
function SlidePreviewPane({ slide }: { slide: SlidePreview }) {
  const t = useTranslations('dashboard.generationPanel');
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide text-muted">
        <MonitorPlay className="size-3.5 text-accent-400" aria-hidden="true" />
        {t('renderPreview')}
      </p>
      <div className="relative aspect-video overflow-hidden rounded-md border border-border bg-gradient-to-br from-primary-950 to-neutral-950 shadow-md">
        {/* Décor géométrique fixe de la slide */}
        <svg viewBox="0 0 320 180" className="absolute inset-0 h-full w-full" aria-hidden="true">
          <circle cx="288" cy="24" r="60" className="fill-primary-600/15" />
          <rect x="242" y="118" width="52" height="52" rx="10" transform="rotate(45 268 144)" className="fill-accent-400/10 stroke-accent-400/30" strokeWidth="1" />
          <path d="M0 168 H320" className="stroke-primary-400/20" strokeWidth="1" />
        </svg>

        {/* Contenu de la slide — glisse à chaque changement */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${slide.kicker}-${slide.title}`}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={transitions.enter}
            className="absolute inset-0 flex flex-col justify-center gap-2.5 p-5 sm:p-6"
          >
            <p className="text-2xs font-semibold uppercase tracking-widest text-accent-400">{slide.kicker}</p>
            <h4 className="font-display text-lg font-semibold leading-tight text-neutral-50 sm:text-xl">
              {slide.title}
            </h4>
            <ul className="mt-1 space-y-1.5">
              {slide.bullets.map((bullet) => (
                <li key={bullet} className="flex items-center gap-2 text-xs text-neutral-300">
                  <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rotate-45 rounded-[2px] bg-accent-400" />
                  {bullet}
                </li>
              ))}
            </ul>
          </motion.div>
        </AnimatePresence>

        {/* Numéro de slide */}
        <span className="absolute bottom-2.5 end-3 text-2xs tabular-nums text-neutral-500">{slide.slideNumber}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Panneau                                                              */
/* ------------------------------------------------------------------ */

export interface GenerationPanelProps {
  /** Id Mongo du cours suivi — alimente le flux SSE. */
  courseId: string;
  /** Titre du cours en cours de génération. */
  courseTitle: string;
  /** État initial connu côté serveur (GenerationJob) — avant le 1er événement SSE. */
  initialStep?: string | null;
  initialProgress?: number;
  className?: string;
}

export function GenerationPanel({
  courseId,
  courseTitle,
  initialStep = null,
  initialProgress = 0,
  className,
}: GenerationPanelProps) {
  const { step, progress, logs, connected } = useCourseProgress(courseId);
  const t = useTranslations('dashboard.generationPanel');
  const format = useFormatter();

  // Le flux prime ; l'état serveur (snapshot DB) sert de première peinture.
  const effectiveStep = step ?? initialStep;
  const stepProgress = step ? progress : initialProgress;
  const currentIndex = resolveStepIndex(effectiveStep);
  const currentStep = PIPELINE_STEPS[currentIndex]!;

  // Avancement global : étapes franchies + fraction de l'étape courante.
  const clamped = Math.min(Math.max(stepProgress, 0), 100);
  const globalProgress = Math.round(((currentIndex + clamped / 100) / PIPELINE_STEPS.length) * 100);

  const lastLog = logs.length > 0 ? logs[logs.length - 1] : undefined;
  const failed = lastLog?.level === 'error';
  const done = currentIndex === PIPELINE_STEPS.length - 1 && clamped >= 100;
  const status: GenerationTimelineStatus = failed ? 'failed' : done ? 'done' : 'running';

  // Lignes du terminal : logs réels, sinon message d'attente.
  const lines: TerminalLine[] =
    logs.length > 0
      ? logs.map((log) => ({
          time: format.dateTime(new Date(log.ts), {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
          }),
          level: log.level,
          text: log.msg,
        }))
      : [
          {
            time: '--:--:--',
            level: 'muted',
            text: connected
              ? t('waitingConnected')
              : t('connecting'),
          },
        ];

  // Slide synthétique : étape courante + derniers messages du worker.
  const recentMessages = logs.slice(-3).map((log) => log.msg);
  const slide: SlidePreview = {
    stepIndex: currentIndex,
    kicker: t(currentStep.labelKey),
    title: courseTitle,
    bullets: recentMessages.length > 0 ? recentMessages : [t(currentStep.descriptionKey)],
    slideNumber: t('slideNumber', { current: currentIndex + 1, total: PIPELINE_STEPS.length }),
  };

  // GenerationTimeline attend un tableau mutable de GenerationStep.
  const steps: GenerationStep[] = PIPELINE_STEPS.map(({ id, labelKey, descriptionKey }) => ({
    id,
    label: t(labelKey),
    description: t(descriptionKey),
  }));

  return (
    <Card wrapperClassName={className}>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-2xs font-semibold uppercase tracking-wide text-muted">{t('liveGeneration')}</p>
            <h2 className="mt-0.5 truncate font-display text-xl font-semibold text-foreground">{courseTitle}</h2>
          </div>
          <Badge variant={failed ? 'failed' : done ? 'ready' : 'generating'}>
            {failed ? t('status.failed') : done ? t('status.done') : t('status.running')}
          </Badge>
        </div>
        <Progress value={globalProgress} label={t('globalProgress')} showLabel />
      </CardHeader>

      <CardContent>
        <div className="grid gap-6 lg:grid-cols-[minmax(220px,260px)_1fr] xl:grid-cols-[minmax(220px,260px)_1fr_minmax(260px,320px)]">
          {/* 1. Timeline des étapes */}
          <GenerationTimeline steps={steps} currentIndex={currentIndex} status={status} />

          {/* 2. Terminal de logs */}
          <LogTerminal lines={lines} />

          {/* 3. Aperçu de slide (colonne dédiée en xl, sous le terminal sinon) */}
          <div className={cn('lg:col-start-2 xl:col-start-3 xl:row-start-1')}>
            <SlidePreviewPane slide={slide} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
