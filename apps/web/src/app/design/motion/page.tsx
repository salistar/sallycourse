'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  BookOpen,
  Clock,
  GraduationCap,
  ListChecks,
  PartyPopper,
  Play,
  RotateCcw,
  Sparkles,
  TriangleAlert,
  Users,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui';
import {
  Confetti,
  CountUp,
  GenerationTimeline,
  StaggerItem,
  StaggerList,
  TiltCard,
  motionDurations,
  motionEasings,
  transitions,
  usePrefersReducedMotion,
  type GenerationStep,
  type GenerationTimelineStatus,
} from '@/components/motion';

/**
 * Page de démonstration /design/motion — le système de micro-interactions
 * SALISTAR en situation. Chaque bloc montre CE QUE l'animation communique
 * (entrée, progression, réussite, interactivité), pas un effet gratuit.
 */

/* ------------------------------------------------------------------ */
/* Structure de la galerie                                             */
/* ------------------------------------------------------------------ */

/** Section titrée, cohérente avec /design/components. */
function Section({
  title,
  intent,
  children,
}: {
  title: string;
  /** Ce que le mouvement raconte — affiché sous le titre. */
  intent: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-6">
      <div>
        <div className="flex items-center gap-4">
          <h2 className="font-display text-2xl font-semibold text-foreground">{title}</h2>
          <div className="h-px flex-1 bg-gradient-to-r from-primary-500/40 to-transparent" />
        </div>
        <p className="mt-2 max-w-2xl text-sm text-muted">{intent}</p>
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Démo 1 — Timeline de génération + confettis                         */
/* ------------------------------------------------------------------ */

/** Étapes types d'une génération de cours SallyCourse. */
const GENERATION_STEP_KEYS = [
  { id: 'analyse', labelKey: 'steps.analyse.label', descriptionKey: 'steps.analyse.description' },
  { id: 'plan', labelKey: 'steps.plan.label', descriptionKey: 'steps.plan.description' },
  { id: 'contenu', labelKey: 'steps.contenu.label', descriptionKey: 'steps.contenu.description' },
  { id: 'quiz', labelKey: 'steps.quiz.label', descriptionKey: 'steps.quiz.description' },
  { id: 'assemblage', labelKey: 'steps.assemblage.label', descriptionKey: 'steps.assemblage.description' },
] as const;

/** Cadence de la simulation (une étape « travaille » ~1.3 s). */
const SIMULATION_STEP_MS = 1300;

function TimelineDemo() {
  const t = useTranslations('design.motionPage');
  const steps: GenerationStep[] = GENERATION_STEP_KEYS.map((step) => ({
    id: step.id,
    label: t(step.labelKey),
    description: t(step.descriptionKey),
  }));
  const [status, setStatus] = React.useState<GenerationTimelineStatus>('idle');
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [celebrate, setCelebrate] = React.useState(false);
  // Distingue la simulation « réussite » de la simulation « échec ».
  const failPlannedRef = React.useRef(false);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimer = React.useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  React.useEffect(() => stopTimer, [stopTimer]);

  /** Lance la simulation ; `willFail` interrompt le processus à mi-parcours. */
  const run = (willFail: boolean) => {
    stopTimer();
    failPlannedRef.current = willFail;
    setCelebrate(false);
    setStatus('running');
    setCurrentIndex(0);

    timerRef.current = setInterval(() => {
      setCurrentIndex((index) => {
        const next = index + 1;
        if (failPlannedRef.current && next >= 2) {
          stopTimer();
          setStatus('failed');
          return 2; // échec pendant la rédaction des leçons
        }
        if (next >= GENERATION_STEP_KEYS.length) {
          stopTimer();
          setStatus('done');
          setCelebrate(true); // la réussite se fête — une seule fois
          return GENERATION_STEP_KEYS.length - 1;
        }
        return next;
      });
    }, SIMULATION_STEP_MS);
  };

  const reset = () => {
    stopTimer();
    setCelebrate(false);
    setStatus('idle');
    setCurrentIndex(0);
  };

  const statusBadge: Record<GenerationTimelineStatus, React.ReactNode> = {
    idle: <Badge variant="draft">{t('status.idle')}</Badge>,
    running: <Badge variant="generating">{t('status.running')}</Badge>,
    done: <Badge variant="ready">{t('status.done')}</Badge>,
    failed: <Badge variant="failed">{t('status.failed')}</Badge>,
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>{t('timeline.cardTitle')}</CardTitle>
          {statusBadge[status]}
        </div>
        <CardDescription>{t('timeline.cardDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
        <GenerationTimeline
          steps={steps}
          currentIndex={currentIndex}
          status={status}
          className="md:flex-1"
        />
        <div className="flex shrink-0 flex-wrap gap-3 md:flex-col">
          <Button onClick={() => run(false)} disabled={status === 'running'}>
            <Play aria-hidden="true" /> {t('timeline.simulateSuccess')}
          </Button>
          <Button variant="secondary" onClick={() => run(true)} disabled={status === 'running'}>
            <TriangleAlert aria-hidden="true" /> {t('timeline.simulateFailure')}
          </Button>
          <Button variant="ghost" onClick={reset}>
            <RotateCcw aria-hidden="true" /> {t('timeline.reset')}
          </Button>
        </div>
      </CardContent>

      {/* Confettis or/violet — déclenchés UNIQUEMENT par la réussite. */}
      <Confetti active={celebrate} onComplete={() => setCelebrate(false)} />
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Démo 2 — Stagger de listes de cours                                 */
/* ------------------------------------------------------------------ */

const DEMO_COURSES = [
  { id: 'react', titleKey: 'courses.react.title', lessons: 24, levelKey: 'levels.beginner' },
  { id: 'nest', titleKey: 'courses.nest.title', lessons: 31, levelKey: 'levels.intermediate' },
  { id: 'ts', titleKey: 'courses.ts.title', lessons: 18, levelKey: 'levels.advanced' },
  { id: 'tailwind', titleKey: 'courses.tailwind.title', lessons: 15, levelKey: 'levels.intermediate' },
  { id: 'ai', titleKey: 'courses.ai.title', lessons: 27, levelKey: 'levels.advanced' },
  { id: 'next', titleKey: 'courses.next.title', lessons: 22, levelKey: 'levels.intermediate' },
] as const;

function StaggerDemo() {
  const t = useTranslations('design.motionPage');
  // Changer la clé remonte la liste → l'orchestration se rejoue.
  const [replayKey, setReplayKey] = React.useState(0);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button variant="secondary" onClick={() => setReplayKey((k) => k + 1)}>
          <RotateCcw aria-hidden="true" /> {t('stagger.replay')}
        </Button>
      </div>
      <StaggerList
        key={replayKey}
        as="ul"
        className="grid gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3"
      >
        {DEMO_COURSES.map((course) => (
          <StaggerItem key={course.id} as="li">
            <Card interactive className="h-full">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <BookOpen className="size-5 text-primary" aria-hidden="true" />
                  <Badge variant="published" hideDot>
                    {t(course.levelKey)}
                  </Badge>
                </div>
                <CardTitle className="text-lg">{t(course.titleKey)}</CardTitle>
                <CardDescription>
                  {t('stagger.lessonsGenerated', { count: course.lessons })}
                </CardDescription>
              </CardHeader>
            </Card>
          </StaggerItem>
        ))}
      </StaggerList>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Démo 3 — Compteurs animés                                           */
/* ------------------------------------------------------------------ */

const DEMO_STATS = [
  { id: 'courses', labelKey: 'stats.courses.label', value: 1284, icon: GraduationCap, suffix: '' },
  { id: 'lessons', labelKey: 'stats.lessons.label', value: 30912, icon: ListChecks, suffix: '' },
  { id: 'hours', labelKey: 'stats.hours.label', value: 4165, icon: Clock, suffix: ' h' },
  { id: 'satisfaction', labelKey: 'stats.satisfaction.label', value: 97.4, icon: Users, suffix: ' %', decimals: 1 },
] as const;

function CountUpDemo() {
  const t = useTranslations('design.motionPage');
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {DEMO_STATS.map((stat) => (
        <Card key={stat.id}>
          <CardContent className="flex flex-col gap-2 pt-6">
            <stat.icon className="size-5 text-accent" aria-hidden="true" />
            <CountUp
              value={stat.value}
              decimals={'decimals' in stat ? stat.decimals : 0}
              suffix={stat.suffix}
              className="font-display text-3xl font-semibold text-foreground"
            />
            <span className="text-sm text-muted">{t(stat.labelKey)}</span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Démo 4 — TiltCard                                                   */
/* ------------------------------------------------------------------ */

function TiltDemo() {
  const t = useTranslations('design.motionPage');
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <TiltCard>
        <Card interactive className="h-full">
          <CardHeader>
            <Sparkles className="size-5 text-accent" aria-hidden="true" />
            <CardTitle>{t('tilt.default.title')}</CardTitle>
            <CardDescription>{t('tilt.default.description')}</CardDescription>
          </CardHeader>
        </Card>
      </TiltCard>
      <TiltCard maxTilt={6}>
        <Card interactive className="h-full">
          <CardHeader>
            <PartyPopper className="size-5 text-primary" aria-hidden="true" />
            <CardTitle>{t('tilt.exaggerated.title')}</CardTitle>
            <CardDescription>{t('tilt.exaggerated.description')}</CardDescription>
          </CardHeader>
        </Card>
      </TiltCard>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Démo 5 — Variants & transitions de référence                        */
/* ------------------------------------------------------------------ */

function TokensDemo() {
  const t = useTranslations('design.motionPage');
  const [replayKey, setReplayKey] = React.useState(0);
  const prefersReducedMotion = usePrefersReducedMotion();

  const swatches = [
    { name: 'enter — base / out', transition: transitions.enter },
    { name: 'exit — fast / in', transition: transitions.exit },
    { name: 'state — slow / standard', transition: transitions.state },
    { name: 'springSoft', transition: transitions.springSoft },
    { name: 'springSnappy', transition: transitions.springSnappy },
  ] as const;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => setReplayKey((k) => k + 1)}>
          <RotateCcw aria-hidden="true" /> {t('tokens.replay')}
        </Button>
        {prefersReducedMotion && (
          <span className="text-sm text-muted">{t('tokens.reducedMotion')}</span>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {swatches.map((swatch) => (
          <motion.div
            key={`${swatch.name}-${replayKey}`}
            // Fade-in-up inline (les variants partagés embarquent leur propre
            // transition — ici on veut comparer les cinq tempéraments).
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={swatch.transition}
            className="flex h-24 items-center justify-center rounded-md border border-border bg-surface-subtle px-3 text-center text-xs font-medium text-muted"
          >
            {swatch.name}
          </motion.div>
        ))}
      </div>
      <p className="text-xs text-muted">
        {t('tokens.durations', {
          instant: Math.round(motionDurations.instant * 1000),
          fast: Math.round(motionDurations.fast * 1000),
          base: Math.round(motionDurations.base * 1000),
          slow: Math.round(motionDurations.slow * 1000),
          slower: Math.round(motionDurations.slower * 1000),
          easing: motionEasings.out.join(', '),
        })}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function MotionGalleryPage() {
  const t = useTranslations('design.motionPage');
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-16 px-6 py-16">
      <header className="flex flex-col gap-4">
        <Badge variant="published" hideDot>
          {t('header.badge')}
        </Badge>
        <h1 className="font-display text-4xl font-semibold text-foreground">
          {t('header.title')}
        </h1>
        <p className="max-w-2xl text-lg text-muted">
          {t.rich('header.intro', {
            code: (chunks) => (
              <code className="rounded-sm bg-surface-subtle px-1.5 py-0.5 text-sm">
                {chunks}
              </code>
            ),
          })}
        </p>
        <p className="text-sm text-muted">
          <Link
            href="/design/components"
            className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
          >
            {t('header.componentsLink')} <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>{' '}
          {t.rich('header.transitionNote', {
            code: (chunks) => (
              <code className="rounded-sm bg-surface-subtle px-1.5 py-0.5">{chunks}</code>
            ),
          })}
        </p>
      </header>

      <Section
        title={t('sections.timeline.title')}
        intent={t('sections.timeline.intent')}
      >
        <TimelineDemo />
      </Section>

      <Section
        title={t('sections.stagger.title')}
        intent={t('sections.stagger.intent')}
      >
        <StaggerDemo />
      </Section>

      <Section
        title={t('sections.countup.title')}
        intent={t('sections.countup.intent')}
      >
        <CountUpDemo />
      </Section>

      <Section
        title={t('sections.tilt.title')}
        intent={t('sections.tilt.intent')}
      >
        <TiltDemo />
      </Section>

      <Section
        title={t('sections.transitions.title')}
        intent={t('sections.transitions.intent')}
      >
        <TokensDemo />
      </Section>
    </main>
  );
}
