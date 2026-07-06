'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { Wand2 } from 'lucide-react';
import { createCourseInputSchema, type Difficulty } from '@sallycourse/shared';
import { Button } from '@/components/ui';
import { transitions } from '@/components/motion/motion-config';
import { TitleField } from './title-field';
import { TitleSuggestions } from './title-suggestions';
import { buildTitleSuggestions } from './mock-title-suggestions';
import { LevelSelector } from './level-selector';
import {
  AdvancedOptionsPanel,
  DEFAULT_ADVANCED_OPTIONS,
  type AdvancedOptions,
} from './advanced-options-panel';
import { GenerationScreen, COURSE_TITLE_LAYOUT_ID } from './generation-screen';

/**
 * Expérience « créer un cours » — moment signature plein écran.
 * Deux actes : COMPOSITION (l'utilisateur écrit la couverture de son cours,
 * choisit un niveau) puis GÉNÉRATION (le titre se morphe en en-tête de la
 * timeline via un layoutId Framer Motion partagé).
 */

/** Délai de debounce des suggestions sous la frappe. */
const SUGGESTIONS_DEBOUNCE_MS = 350;

type Phase = 'compose' | 'generating';

interface FieldErrors {
  title?: string;
  difficulty?: string;
}

/** Traduit les issues zod du schéma partagé en messages français ciblés. */
function toFieldErrors(error: import('zod').ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (field === 'title' && !errors.title) {
      errors.title =
        issue.code === 'too_big'
          ? 'Le titre ne peut pas dépasser 120 caractères.'
          : 'Donnez un titre d’au moins 3 caractères — c’est la couverture de votre cours.';
    }
    if (field === 'difficulty' && !errors.difficulty) {
      errors.difficulty = 'Choisissez un niveau : il calibre le ton, le rythme et les quiz.';
    }
  }
  return errors;
}

export function CreateCourseExperience() {
  const [phase, setPhase] = React.useState<Phase>('compose');

  // Brief du cours
  const [title, setTitle] = React.useState('');
  const [difficulty, setDifficulty] = React.useState<Difficulty | null>(null);
  const [options, setOptions] = React.useState<AdvancedOptions>(DEFAULT_ADVANCED_OPTIONS);
  const [errors, setErrors] = React.useState<FieldErrors>({});

  // Suggestions de titres — mock local, débouncé ; masquées après un choix
  // (jusqu'à la prochaine frappe) pour ne pas re-suggérer ce qui vient d'être pris.
  const [suggestions, setSuggestions] = React.useState<string[]>([]);
  const suppressSuggestionsRef = React.useRef(false);

  React.useEffect(() => {
    if (phase !== 'compose') return;
    if (suppressSuggestionsRef.current) {
      setSuggestions([]);
      return;
    }
    const timer = window.setTimeout(() => {
      setSuggestions(buildTitleSuggestions(title).filter((s) => s !== title.trim()));
    }, SUGGESTIONS_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [title, phase]);

  const handleTitleChange = (next: string) => {
    suppressSuggestionsRef.current = false;
    setTitle(next);
    if (errors.title) setErrors((prev) => ({ ...prev, title: undefined }));
  };

  const handlePickSuggestion = (suggestion: string) => {
    suppressSuggestionsRef.current = true;
    setTitle(suggestion);
    setSuggestions([]);
    if (errors.title) setErrors((prev) => ({ ...prev, title: undefined }));
  };

  const handleLevelChange = (level: Difficulty) => {
    setDifficulty(level);
    if (errors.difficulty) setErrors((prev) => ({ ...prev, difficulty: undefined }));
  };

  /** Validation zod (schéma partagé) puis bascule vers l'acte génération. */
  const handleSubmit = () => {
    const result = createCourseInputSchema.safeParse({
      title: title.trim(),
      difficulty: difficulty ?? undefined,
      locale: options.locale,
      ttsVoice: options.ttsVoice,
      targetPlatforms: options.targetPlatforms,
      approxSections: options.approxSections,
    });

    if (!result.success) {
      setErrors(toFieldErrors(result.error));
      return;
    }

    setErrors({});
    setTitle(result.data.title);
    setPhase('generating');
  };

  // Acte 2 — le titre voyage vers l'en-tête via le layoutId partagé.
  if (phase === 'generating' && difficulty) {
    return (
      <main className="min-h-dvh bg-background">
        <GenerationScreen
          title={title}
          difficulty={difficulty}
          options={options}
          onBack={() => setPhase('compose')}
        />
      </main>
    );
  }

  // Acte 1 — plein écran épuré : la page EST le formulaire.
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center bg-background px-6 py-16">
      {/* Halo d'ambiance très discret derrière la zone d'écriture */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-1/4 mx-auto h-64 max-w-2xl rounded-full bg-primary-soft blur-3xl"
      />

      <div className="relative flex w-full max-w-3xl flex-col items-center gap-10">
        <motion.p
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={transitions.enter}
          className="text-2xs font-semibold uppercase tracking-widest text-muted"
        >
          Nouveau cours — écrivez la couverture
        </motion.p>

        {/* Le titre : très grande typographie display, layoutId partagé */}
        <motion.div layoutId={COURSE_TITLE_LAYOUT_ID} transition={transitions.springSoft} className="w-full">
          <TitleField
            value={title}
            onChange={handleTitleChange}
            error={errors.title}
            onEnter={handleSubmit}
          />
        </motion.div>

        <TitleSuggestions suggestions={suggestions} onPick={handlePickSuggestion} />

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...transitions.enter, delay: 0.15 }}
          className="w-full"
        >
          <p className="mb-4 text-center text-2xs font-semibold uppercase tracking-widest text-muted">
            Pour quel niveau ?
          </p>
          <LevelSelector value={difficulty} onChange={handleLevelChange} error={errors.difficulty} />
        </motion.div>

        {/* Pied de scène : options discrètes + moment premium (CTA or) */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...transitions.enter, delay: 0.25 }}
          className="flex w-full flex-col items-center gap-4 sm:flex-row sm:justify-between"
        >
          <AdvancedOptionsPanel value={options} onChange={setOptions} />
          <Button variant="gold" size="lg" onClick={handleSubmit} className="w-full sm:w-auto">
            <Wand2 aria-hidden="true" />
            Générer mon cours
          </Button>
        </motion.div>
      </div>
    </main>
  );
}
