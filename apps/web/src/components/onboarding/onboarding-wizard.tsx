'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Sparkles, Wand2 } from 'lucide-react';
// Sous-module direct (et non le barrel @sallycourse/shared) : le barrel
// réexporte crypto.ts (node:crypto), incompatible avec le bundle client.
import { COURSE_TEMPLATES, type CourseTemplate } from '@sallycourse/shared/course-templates';
import { cn } from '@/lib/cn';
import { Button, buttonVariants } from '@/components/ui';
import { transitions } from '@/components/motion';
import { TemplateCard } from './template-card';

/**
 * Assistant de premier cours (Prompt 58) — deux actes :
 *   1) CHOISIR une niche parmi la bibliothèque de templates (ou partir de zéro).
 *   2) CONFIRMER un titre parmi des exemples « qui marchent », puis lancer la
 *      création (redirection vers /dashboard/new pré-hydraté par le template).
 * Pensé pour le tout premier login (aucun cours) : rassurant, premium, sobre.
 */

type Step = 'pick' | 'title';

/** Variantes de transition entre les deux actes (respecte le sens de lecture). */
const stepVariants = {
  enter: (dir: number) => ({ opacity: 0, x: dir > 0 ? 32 : -32 }),
  center: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir > 0 ? -32 : 32 }),
};

export interface OnboardingWizardProps {
  /** Prénom/nom affiché dans l'accueil (facultatif). */
  displayName?: string;
}

export function OnboardingWizard({ displayName }: OnboardingWizardProps) {
  const router = useRouter();
  const [step, setStep] = React.useState<Step>('pick');
  const [direction, setDirection] = React.useState(1);
  const [selected, setSelected] = React.useState<CourseTemplate | null>(null);
  const [title, setTitle] = React.useState('');
  const [launching, setLaunching] = React.useState(false);

  const goTitle = (template: CourseTemplate) => {
    setSelected(template);
    // exampleTitles a un min(2) au schéma : le premier élément existe toujours.
    setTitle(template.exampleTitles[0] ?? template.name);
    setDirection(1);
    setStep('title');
  };

  const goBack = () => {
    setDirection(-1);
    setStep('pick');
  };

  // Lance la création : on passe par /dashboard/new pré-hydraté (le template
  // porte niveau/langue/sections + le titre choisi). L'écran de génération
  // signature vit déjà là-bas — on ne le duplique pas.
  const launch = () => {
    if (!selected || launching) return;
    setLaunching(true);
    const params = new URLSearchParams({ template: selected.id });
    const trimmed = title.trim();
    if (trimmed) params.set('title', trimmed);
    router.push(`/dashboard/new?${params.toString()}`);
  };

  return (
    <div className="relative mx-auto flex w-full max-w-5xl flex-col items-center gap-10 px-4 py-10 sm:py-16">
      {/* Halo d'ambiance discret */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-8 mx-auto h-56 max-w-2xl rounded-full bg-primary-soft blur-3xl"
      />

      <header className="relative flex flex-col items-center gap-3 text-center">
        <motion.span
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={transitions.enter}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-1.5 text-2xs font-semibold uppercase tracking-widest text-muted"
        >
          <Sparkles className="size-3.5 text-accent-400" aria-hidden="true" />
          Bienvenue{displayName ? `, ${displayName}` : ''}
        </motion.span>
        <motion.h1
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...transitions.enter, delay: 0.05 }}
          className="max-w-2xl font-display text-3xl font-semibold text-foreground sm:text-4xl"
        >
          {step === 'pick'
            ? 'Créons votre premier cours'
            : 'Un titre qui donne envie de cliquer'}
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ ...transitions.enter, delay: 0.1 }}
          className="max-w-xl text-sm leading-relaxed text-muted sm:text-base"
        >
          {step === 'pick'
            ? 'Partez d’un modèle de niche — il pré-configure la structure, le ton et le niveau. Vous ajusterez tout ensuite.'
            : 'Choisissez un exemple éprouvé ou personnalisez-le. SallyCourse s’occupe du reste.'}
        </motion.p>
      </header>

      {/* Indicateur d'étape */}
      <ol className="relative flex items-center gap-3" aria-label="Progression de l’assistant">
        {(['pick', 'title'] as const).map((s, i) => {
          const active = step === s;
          const done = step === 'title' && s === 'pick';
          return (
            <li key={s} className="flex items-center gap-3">
              <span
                className={cn(
                  'flex size-7 items-center justify-center rounded-full border text-xs font-semibold transition-colors',
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : done
                      ? 'border-primary/50 bg-primary-soft text-foreground'
                      : 'border-border bg-surface text-muted',
                )}
              >
                {i + 1}
              </span>
              {i === 0 && <span aria-hidden="true" className="h-px w-8 bg-border" />}
            </li>
          );
        })}
      </ol>

      <div className="relative w-full overflow-hidden">
        <AnimatePresence mode="wait" custom={direction} initial={false}>
          {step === 'pick' ? (
            <motion.section
              key="pick"
              custom={direction}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={transitions.springSoft}
              aria-label="Choisir un modèle"
            >
              <div
                role="radiogroup"
                aria-label="Modèles de cours par niche"
                className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-2"
              >
                {COURSE_TEMPLATES.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    selected={selected?.id === template.id}
                    onSelect={goTitle}
                  />
                ))}
              </div>

              <div className="mt-8 flex flex-col items-center gap-3">
                <span className="text-2xs uppercase tracking-widest text-muted">ou</span>
                <Link
                  href="/dashboard/new"
                  className={buttonVariants({ variant: 'ghost', size: 'lg' })}
                >
                  Partir d’une page blanche
                  <ArrowRight aria-hidden="true" className="rtl:rotate-180" />
                </Link>
              </div>
            </motion.section>
          ) : (
            <motion.section
              key="title"
              custom={direction}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={transitions.springSoft}
              aria-label="Confirmer le titre"
              className="mx-auto flex w-full max-w-2xl flex-col gap-6"
            >
              {selected && (
                <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-4">
                  <span className="text-2xl" aria-hidden="true">
                    {selected.emoji}
                  </span>
                  <div className="min-w-0">
                    <p className="font-display text-sm font-semibold text-foreground">
                      {selected.name}
                    </p>
                    <p className="truncate text-xs text-muted">{selected.tagline}</p>
                  </div>
                </div>
              )}

              {/* Champ titre — grande typographie */}
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="onboarding-title"
                  className="text-2xs font-semibold uppercase tracking-widest text-muted"
                >
                  Le titre de votre cours
                </label>
                <textarea
                  id="onboarding-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  rows={2}
                  maxLength={120}
                  className={cn(
                    'w-full resize-none rounded-lg border border-input bg-surface px-4 py-3',
                    'font-display text-xl font-semibold text-foreground',
                    'placeholder:text-muted/50',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80',
                    'focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                  )}
                  placeholder="Ex. : Maîtriser Excel en 30 jours"
                />
                <p className="text-end text-2xs text-muted/70">{title.trim().length}/120</p>
              </div>

              {/* Exemples de titres qui marchent */}
              {selected && (
                <div className="flex flex-col gap-2">
                  <p className="text-2xs font-semibold uppercase tracking-widest text-muted">
                    Des titres qui marchent
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {selected.exampleTitles.map((example) => {
                      const active = title.trim() === example;
                      return (
                        <button
                          key={example}
                          type="button"
                          onClick={() => setTitle(example)}
                          className={cn(
                            'rounded-full border px-3.5 py-2 text-start text-xs transition-colors',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80',
                            active
                              ? 'border-primary bg-primary-soft text-foreground'
                              : 'border-border bg-surface text-muted hover:border-ring/50 hover:text-foreground',
                          )}
                        >
                          {example}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="mt-2 flex items-center justify-between gap-3">
                <Button variant="ghost" onClick={goBack}>
                  <ArrowLeft aria-hidden="true" className="rtl:rotate-180" />
                  Retour
                </Button>
                <Button
                  variant="gold"
                  size="lg"
                  onClick={launch}
                  loading={launching}
                  disabled={title.trim().length < 3}
                >
                  {!launching && <Wand2 aria-hidden="true" />}
                  {launching ? 'Préparation…' : 'Générer mon cours'}
                </Button>
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
