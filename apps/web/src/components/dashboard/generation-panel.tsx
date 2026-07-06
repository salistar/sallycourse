'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { TerminalSquare, MonitorPlay } from 'lucide-react';
import { Badge, Card, CardContent, CardHeader, Progress } from '@/components/ui';
import {
  GenerationTimeline,
  transitions,
  usePrefersReducedMotion,
  type GenerationStep,
} from '@/components/motion';
import { cn } from '@/lib/cn';
import {
  MOCK_GENERATION_LOGS,
  MOCK_GENERATION_STEPS,
  MOCK_SLIDE_PREVIEWS,
  type GenerationLogLine,
  type LogLevel,
  type SlidePreview,
} from './mock-data';

/**
 * Panneau « génération en direct » — trois volets synchronisés sur un même
 * flux simulé (mock, câblage temps réel au Prompt 9) :
 *  1. timeline d'étapes (GenerationTimeline, motion D4) ;
 *  2. terminal de logs qui défilent avec auto-scroll ;
 *  3. aperçu de la slide en cours de rendu.
 */

/** Cadence d'apparition des lignes de log (ms). */
const TICK_MS = 1400;

const LOG_TEXT_STYLES: Record<LogLevel, string> = {
  info: 'text-neutral-300',
  step: 'font-semibold text-primary-300',
  success: 'text-success',
  warn: 'text-warning',
};

/** Terminal stylé — chrome macOS discret, fond quasi noir, fonte mono. */
function LogTerminal({ lines }: { lines: GenerationLogLine[] }) {
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
          worker · génération
        </span>
      </div>

      {/* Flux de logs — aria-live poli pour les lecteurs d'écran */}
      <div
        ref={scrollRef}
        aria-live="polite"
        aria-label="Journal de génération"
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

/** Aperçu de la slide en cours — cadre 16:9 façon rendu vidéo. */
function SlidePreviewPane({ slide }: { slide: SlidePreview }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide text-muted">
        <MonitorPlay className="size-3.5 text-accent-400" aria-hidden="true" />
        Aperçu du rendu
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
            key={slide.title}
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

export interface GenerationPanelProps {
  /** Titre du cours en cours de génération. */
  courseTitle: string;
  className?: string;
}

export function GenerationPanel({ courseTitle, className }: GenerationPanelProps) {
  const reduced = usePrefersReducedMotion();
  // Nombre de lignes de log révélées ; pilote timeline, progression et slide.
  const [revealed, setRevealed] = React.useState(1);
  const total = MOCK_GENERATION_LOGS.length;
  const done = revealed >= total;

  React.useEffect(() => {
    // Mouvement réduit : on montre l'état final directement, sans défilement.
    if (reduced) {
      setRevealed(total);
      return;
    }
    if (done) return;
    const timer = window.setInterval(() => {
      setRevealed((n) => Math.min(n + 1, total));
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [reduced, done, total]);

  const lines = MOCK_GENERATION_LOGS.slice(0, revealed);
  const currentIndex = lines[lines.length - 1]?.stepIndex ?? 0;
  const progress = Math.round((revealed / total) * 100);

  // Slide la plus récente dont l'étape est atteinte.
  const slide =
    [...MOCK_SLIDE_PREVIEWS].reverse().find((s) => s.stepIndex <= currentIndex) ?? MOCK_SLIDE_PREVIEWS[0]!;

  // Les étapes mock sont readonly ; GenerationTimeline attend un tableau mutable.
  const steps: GenerationStep[] = MOCK_GENERATION_STEPS.map((s) => ({ ...s }));

  return (
    <Card wrapperClassName={className}>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-2xs font-semibold uppercase tracking-wide text-muted">Génération en direct</p>
            <h2 className="mt-0.5 truncate font-display text-xl font-semibold text-foreground">{courseTitle}</h2>
          </div>
          <Badge variant={done ? 'ready' : 'generating'}>{done ? 'Terminé' : 'En cours'}</Badge>
        </div>
        <Progress value={progress} label="Avancement global" showLabel />
      </CardHeader>

      <CardContent>
        <div className="grid gap-6 lg:grid-cols-[minmax(220px,260px)_1fr] xl:grid-cols-[minmax(220px,260px)_1fr_minmax(260px,320px)]">
          {/* 1. Timeline des étapes */}
          <GenerationTimeline
            steps={steps}
            currentIndex={currentIndex}
            status={done ? 'done' : 'running'}
          />

          {/* 2. Terminal de logs */}
          <LogTerminal lines={lines} />

          {/* 3. Aperçu de slide (colonne dédiée en xl, sous le terminal sinon) */}
          <div className="lg:col-start-2 xl:col-start-3 xl:row-start-1">
            <SlidePreviewPane slide={slide} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
