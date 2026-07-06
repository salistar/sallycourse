'use client';

import * as React from 'react';
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
const GENERATION_STEPS: GenerationStep[] = [
  { id: 'analyse', label: 'Analyse du sujet', description: 'Titre, niveau et audience cible' },
  { id: 'plan', label: 'Construction du plan', description: 'Sections, chapitres et prérequis' },
  { id: 'contenu', label: 'Rédaction des leçons', description: 'Vidéos, articles et travaux pratiques' },
  { id: 'quiz', label: 'Génération des quiz', description: 'Questions alignées sur chaque chapitre' },
  { id: 'assemblage', label: 'Assemblage final', description: 'Relecture, métadonnées et publication' },
];

/** Cadence de la simulation (une étape « travaille » ~1.3 s). */
const SIMULATION_STEP_MS = 1300;

function TimelineDemo() {
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
        if (next >= GENERATION_STEPS.length) {
          stopTimer();
          setStatus('done');
          setCelebrate(true); // la réussite se fête — une seule fois
          return GENERATION_STEPS.length - 1;
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
    idle: <Badge variant="draft">En attente</Badge>,
    running: <Badge variant="generating">Génération…</Badge>,
    done: <Badge variant="ready">Cours prêt</Badge>,
    failed: <Badge variant="failed">Échec</Badge>,
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>« React 19 pour débutants » — niveau Débutant</CardTitle>
          {statusBadge[status]}
        </div>
        <CardDescription>
          Le rail se remplit au rythme des étapes ; l'étape active pulse pendant que le
          système travaille ; la fin déclenche la célébration.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
        <GenerationTimeline
          steps={GENERATION_STEPS}
          currentIndex={currentIndex}
          status={status}
          className="md:flex-1"
        />
        <div className="flex shrink-0 flex-wrap gap-3 md:flex-col">
          <Button onClick={() => run(false)} disabled={status === 'running'}>
            <Play aria-hidden="true" /> Simuler une réussite
          </Button>
          <Button variant="secondary" onClick={() => run(true)} disabled={status === 'running'}>
            <TriangleAlert aria-hidden="true" /> Simuler un échec
          </Button>
          <Button variant="ghost" onClick={reset}>
            <RotateCcw aria-hidden="true" /> Réinitialiser
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
  { id: 'react', title: 'React 19 pour débutants', lessons: 24, level: 'Débutant' },
  { id: 'nest', title: 'NestJS : API robustes', lessons: 31, level: 'Intermédiaire' },
  { id: 'ts', title: 'TypeScript avancé', lessons: 18, level: 'Avancé' },
  { id: 'tailwind', title: 'Design systems avec Tailwind', lessons: 15, level: 'Intermédiaire' },
  { id: 'ai', title: 'IA générative en production', lessons: 27, level: 'Avancé' },
  { id: 'next', title: 'Next.js App Router de A à Z', lessons: 22, level: 'Intermédiaire' },
] as const;

function StaggerDemo() {
  // Changer la clé remonte la liste → l'orchestration se rejoue.
  const [replayKey, setReplayKey] = React.useState(0);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button variant="secondary" onClick={() => setReplayKey((k) => k + 1)}>
          <RotateCcw aria-hidden="true" /> Rejouer l'entrée
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
                    {course.level}
                  </Badge>
                </div>
                <CardTitle className="text-lg">{course.title}</CardTitle>
                <CardDescription>{course.lessons} leçons générées</CardDescription>
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
  { id: 'courses', label: 'Cours générés', value: 1284, icon: GraduationCap, suffix: '' },
  { id: 'lessons', label: 'Leçons produites', value: 30912, icon: ListChecks, suffix: '' },
  { id: 'hours', label: 'Heures de contenu', value: 4165, icon: Clock, suffix: ' h' },
  { id: 'satisfaction', label: 'Satisfaction apprenants', value: 97.4, icon: Users, suffix: ' %', decimals: 1 },
] as const;

function CountUpDemo() {
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
            <span className="text-sm text-muted">{stat.label}</span>
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
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <TiltCard>
        <Card interactive className="h-full">
          <CardHeader>
            <Sparkles className="size-5 text-accent" aria-hidden="true" />
            <CardTitle>Inclinaison 2° (défaut)</CardTitle>
            <CardDescription>
              Survolez : la carte suit le pointeur avec un ressort doux — assez pour
              signaler l'interactivité, jamais assez pour distraire.
            </CardDescription>
          </CardHeader>
        </Card>
      </TiltCard>
      <TiltCard maxTilt={6}>
        <Card interactive className="h-full">
          <CardHeader>
            <PartyPopper className="size-5 text-primary" aria-hidden="true" />
            <CardTitle>Inclinaison 6° (exagérée)</CardTitle>
            <CardDescription>
              Version amplifiée pour rendre l'effet lisible en démo — à ne PAS utiliser
              en production : 2° suffisent.
            </CardDescription>
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
          <RotateCcw aria-hidden="true" /> Rejouer
        </Button>
        {prefersReducedMotion && (
          <span className="text-sm text-muted">
            prefers-reduced-motion actif : les translations sont neutralisées, seuls les
            fondus subsistent.
          </span>
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
        Durées tokens : instant {Math.round(motionDurations.instant * 1000)} ms · fast{' '}
        {Math.round(motionDurations.fast * 1000)} ms · base {Math.round(motionDurations.base * 1000)} ms ·
        slow {Math.round(motionDurations.slow * 1000)} ms · slower{' '}
        {Math.round(motionDurations.slower * 1000)} ms — courbe d'entrée out{' '}
        [{motionEasings.out.join(', ')}].
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function MotionGalleryPage() {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-16 px-6 py-16">
      <header className="flex flex-col gap-4">
        <Badge variant="published" hideDot>
          Design system · D4
        </Badge>
        <h1 className="font-display text-4xl font-semibold text-foreground">
          Motion &amp; micro-interactions
        </h1>
        <p className="max-w-2xl text-lg text-muted">
          Le mouvement SALISTAR communique un état — entrée, progression, réussite,
          interactivité. Durées et courbes proviennent des tokens ; tout respecte{' '}
          <code className="rounded-sm bg-surface-subtle px-1.5 py-0.5 text-sm">
            prefers-reduced-motion
          </code>
          .
        </p>
        <p className="text-sm text-muted">
          <Link
            href="/design/components"
            className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
          >
            Galerie des composants <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>{' '}
          — naviguer entre les deux pages rejoue la transition de page (fade + slide 200 ms
          via <code className="rounded-sm bg-surface-subtle px-1.5 py-0.5">template.tsx</code>).
        </p>
      </header>

      <Section
        title="Timeline de génération"
        intent="Progression d'un processus long : le rail se remplit organiquement, l'étape active pulse, la réussite déclenche coche à ressort + confettis, l'échec fige le rail."
      >
        <TimelineDemo />
      </Section>

      <Section
        title="Listes orchestrées (stagger)"
        intent="L'apparition décalée des cartes communique l'ordre de lecture d'une grille de cours — déclenchée à l'entrée dans le viewport."
      >
        <StaggerDemo />
      </Section>

      <Section
        title="Compteurs animés"
        intent="Les statistiques « s'accumulent » à l'entrée en vue : chiffres tabulaires (pas de tremblement), formatage localisé, valeur finale directe en mouvement réduit."
      >
        <CountUpDemo />
      </Section>

      <Section
        title="Tilt 3D subtil"
        intent="L'inclinaison de ±2° qui suit le pointeur signale qu'une carte est interactive — désactivée au toucher et en mouvement réduit."
      >
        <TiltDemo />
      </Section>

      <Section
        title="Transitions de référence"
        intent="Les cinq transitions nommées par intention (enter, exit, state, springSoft, springSnappy) appliquées au même variant fade-in-up, pour comparer les tempéraments."
      >
        <TokensDemo />
      </Section>
    </main>
  );
}
