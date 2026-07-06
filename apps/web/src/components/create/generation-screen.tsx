'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Globe2, Layers, Mic2, Share2 } from 'lucide-react';
import type { Difficulty } from '@sallycourse/shared';
import { Badge, Button, Progress } from '@/components/ui';
import {
  GenerationTimeline,
  type GenerationStep,
  type GenerationTimelineStatus,
} from '@/components/motion/generation-timeline';
import { transitions } from '@/components/motion/motion-config';
import { TARGET_PLATFORMS, TTS_VOICES, type AdvancedOptions } from './advanced-options-panel';

/**
 * Écran de génération — MAQUETTE : la progression avance sur un simple
 * minuteur en attendant le worker IA. Le titre saisi devient l'en-tête de
 * la timeline via un layoutId partagé avec l'écran de composition
 * (transition cinématique Framer Motion).
 */

/** layoutId partagé — le champ « couverture » se morphe en en-tête. */
export const COURSE_TITLE_LAYOUT_ID = 'course-cover-title';

const GENERATION_STEPS: GenerationStep[] = [
  { id: 'analyse', label: 'Analyse du sujet', description: 'Cartographie du domaine et des attentes.' },
  { id: 'plan', label: 'Construction du plan', description: 'Sections, leçons et objectifs pédagogiques.' },
  { id: 'lecons', label: 'Rédaction des leçons', description: 'Scripts vidéo, articles et travaux pratiques.' },
  { id: 'quiz', label: 'Génération des quiz', description: 'Questions calibrées sur le niveau choisi.' },
  { id: 'assemblage', label: 'Assemblage final', description: 'Narration, rendu vidéo et packaging.' },
];

/** Cadence de la maquette — une étape « aboutit » toutes les 2,4 s. */
const MOCK_STEP_INTERVAL_MS = 2400;

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: 'Débutant',
  intermediate: 'Intermédiaire',
  advanced: 'Avancé',
};

const LOCALE_LABELS: Record<string, string> = {
  fr: 'Français',
  en: 'English',
  ar: 'العربية',
};

export interface GenerationScreenProps {
  title: string;
  difficulty: Difficulty;
  options: AdvancedOptions;
  /** Retour à l'écran de composition (la maquette n'a rien à annuler côté serveur). */
  onBack: () => void;
}

export function GenerationScreen({ title, difficulty, options, onBack }: GenerationScreenProps) {
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [status, setStatus] = React.useState<GenerationTimelineStatus>('running');

  // Progression simulée : chaque tick termine une étape ; la dernière conclut.
  React.useEffect(() => {
    if (status !== 'running') return;
    const timer = window.setInterval(() => {
      setCurrentIndex((index) => {
        if (index >= GENERATION_STEPS.length - 1) {
          setStatus('done');
          return index;
        }
        return index + 1;
      });
    }, MOCK_STEP_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [status]);

  const completed = status === 'done' ? GENERATION_STEPS.length : currentIndex;
  const progressValue = Math.round((completed / GENERATION_STEPS.length) * 100);

  const voiceLabel = TTS_VOICES.find((voice) => voice.id === options.ttsVoice)?.label ?? options.ttsVoice;
  const platformLabels = options.targetPlatforms
    .map((id) => TARGET_PLATFORMS.find((platform) => platform.id === id)?.label ?? id)
    .join(', ');

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-12 sm:py-16">
      {/* En-tête : le titre saisi arrive ici par transition partagée */}
      <header className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Badge variant={status === 'done' ? 'ready' : 'generating'}>
            {status === 'done' ? 'Prêt' : 'Génération'}
          </Badge>
          <span className="text-2xs font-semibold uppercase tracking-widest text-muted">
            Maquette — le worker IA prendra le relais
          </span>
        </div>

        <motion.h1
          layoutId={COURSE_TITLE_LAYOUT_ID}
          transition={transitions.springSoft}
          className="font-display text-3xl font-semibold leading-tight text-foreground sm:text-4xl"
        >
          {title}
        </motion.h1>

        {/* Récapitulatif des choix — chips discrètes */}
        <motion.ul
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...transitions.enter, delay: 0.25 }}
          className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted"
        >
          <li className="flex items-center gap-1.5">
            <Layers className="size-3.5 text-primary-400" aria-hidden="true" />
            {DIFFICULTY_LABELS[difficulty]} · ≈ {options.approxSections} sections
          </li>
          <li className="flex items-center gap-1.5">
            <Globe2 className="size-3.5 text-primary-400" aria-hidden="true" />
            {LOCALE_LABELS[options.locale] ?? options.locale}
          </li>
          <li className="flex items-center gap-1.5">
            <Mic2 className="size-3.5 text-primary-400" aria-hidden="true" />
            {voiceLabel}
          </li>
          {platformLabels && (
            <li className="flex items-center gap-1.5">
              <Share2 className="size-3.5 text-primary-400" aria-hidden="true" />
              {platformLabels}
            </li>
          )}
        </motion.ul>
      </header>

      {/* Jauge globale + timeline détaillée */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...transitions.enter, delay: 0.35 }}
        className="flex flex-col gap-8"
        aria-label="Avancement de la génération"
      >
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-semibold text-foreground">
              {status === 'done' ? 'Cours généré' : GENERATION_STEPS[currentIndex]?.label}
            </span>
            <span className="tabular-nums text-muted">{progressValue}%</span>
          </div>
          <Progress value={progressValue} aria-label="Progression globale" />
        </div>

        <GenerationTimeline steps={GENERATION_STEPS} currentIndex={currentIndex} status={status} />
      </motion.section>

      <motion.footer
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ ...transitions.enter, delay: 0.5 }}
        className="flex items-center justify-between border-t border-border pt-5"
      >
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="rtl:rotate-180" aria-hidden="true" />
          Modifier le brief
        </Button>
        {status === 'done' && (
          <motion.div initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={transitions.springSnappy}>
            <Badge variant="ready">Plan prêt à relire</Badge>
          </motion.div>
        )}
      </motion.footer>
    </div>
  );
}
