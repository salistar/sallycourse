'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Wand2 } from 'lucide-react';
import {
  createCourseInputSchema,
  getCourseTemplate,
  type CourseTemplate,
  type Difficulty,
} from '@sallycourse/shared';
import { Button, useToast } from '@/components/ui';
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
 * timeline via un layoutId Framer Motion partagé). Le submit poste sur
 * /api/courses puis redirige vers la page du cours après la transition.
 */

/** Délai de debounce des suggestions sous la frappe. */
const SUGGESTIONS_DEBOUNCE_MS = 350;

/** Laisse la transition cinématique se jouer avant la redirection. */
const REDIRECT_AFTER_MS = 2600;

/** Longueur minimale de saisie avant d'interroger l'API de suggestions. */
const SUGGESTIONS_MIN_CHARS = 4;

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

/**
 * Valeurs initiales du brief — permettent d'ouvrir /dashboard/new pré-hydraté
 * depuis un template de niche (?template=devops&title=…), typiquement au sortir
 * de l'assistant d'onboarding.
 */
export interface CreateCourseExperienceProps {
  initialTitle?: string;
  initialTemplateId?: string;
}

/** Dérive le brief initial (titre, niveau, options) d'un template optionnel. */
function deriveInitialBrief(props: CreateCourseExperienceProps): {
  title: string;
  difficulty: Difficulty | null;
  options: AdvancedOptions;
  template: CourseTemplate | null;
} {
  const template = props.initialTemplateId ? getCourseTemplate(props.initialTemplateId) ?? null : null;
  const title = props.initialTitle?.trim() || template?.exampleTitles[0] || '';
  const options: AdvancedOptions = template
    ? {
        ...DEFAULT_ADVANCED_OPTIONS,
        locale: template.locale,
        approxSections: template.sections,
      }
    : DEFAULT_ADVANCED_OPTIONS;
  return { title, difficulty: template?.difficulty ?? null, options, template };
}

export function CreateCourseExperience(props: CreateCourseExperienceProps = {}) {
  const router = useRouter();
  const { toast } = useToast();
  const [phase, setPhase] = React.useState<Phase>('compose');
  const [submitting, setSubmitting] = React.useState(false);

  // Brief initial dérivé d'un éventuel template (?template=…).
  const initial = React.useMemo(() => deriveInitialBrief(props), [props.initialTemplateId, props.initialTitle]);

  // Brief du cours
  const [title, setTitle] = React.useState(initial.title);
  const [difficulty, setDifficulty] = React.useState<Difficulty | null>(initial.difficulty);
  const [options, setOptions] = React.useState<AdvancedOptions>(initial.options);
  const [errors, setErrors] = React.useState<FieldErrors>({});

  // Un titre pré-rempli par template ne doit pas déclencher de suggestions
  // tant que l'utilisateur n'a pas commencé à éditer.

  // Redirection différée vers la page du cours (annulée si retour au brief).
  const redirectTimerRef = React.useRef<number | null>(null);
  React.useEffect(
    () => () => {
      if (redirectTimerRef.current !== null) window.clearTimeout(redirectTimerRef.current);
    },
    [],
  );

  // Suggestions de titres — API débouncée (Claude ou mock côté serveur),
  // repli local en cas d'échec réseau ; masquées après un choix (jusqu'à la
  // prochaine frappe) pour ne pas re-suggérer ce qui vient d'être pris.
  const [suggestions, setSuggestions] = React.useState<string[]>([]);
  // Titre pré-rempli (template) : on n'ouvre pas les suggestions d'emblée.
  const suppressSuggestionsRef = React.useRef(initial.title.length > 0);

  React.useEffect(() => {
    if (phase !== 'compose') return;
    if (suppressSuggestionsRef.current) {
      setSuggestions([]);
      return;
    }

    const query = title.trim();
    if (query.length < SUGGESTIONS_MIN_CHARS) {
      setSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch('/api/courses/suggest-title', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: query }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data: unknown = await response.json();
        const list =
          data && typeof data === 'object' && Array.isArray((data as { suggestions?: unknown }).suggestions)
            ? ((data as { suggestions: unknown[] }).suggestions.filter(
                (s): s is string => typeof s === 'string',
              ) as string[])
            : [];
        setSuggestions(list.filter((s) => s !== query));
      } catch {
        if (controller.signal.aborted) return;
        // Repli : moteur local, même contrat string[].
        setSuggestions(buildTitleSuggestions(query).filter((s) => s !== query));
      }
    }, SUGGESTIONS_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
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

  /**
   * Validation zod (schéma partagé), POST /api/courses, puis transition
   * cinématique vers l'acte génération et redirection vers la page du cours.
   */
  const handleSubmit = async () => {
    if (submitting) return;

    const result = createCourseInputSchema.safeParse({
      title: title.trim(),
      difficulty: difficulty ?? undefined,
      locale: options.locale,
      ttsVoice: options.ttsVoice,
      targetPlatforms: options.targetPlatforms,
      approxSections: options.approxSections,
      avatarEnabled: options.avatarEnabled,
      avatarId: options.avatarEnabled ? options.avatarId : undefined,
    });

    if (!result.success) {
      setErrors(toFieldErrors(result.error));
      return;
    }

    setErrors({});
    setTitle(result.data.title);
    setSubmitting(true);

    try {
      const response = await fetch('/api/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // importsMaterial (P90) : signale au serveur qu'un upload de support
        // source va suivre juste après, pour différer le premier traitement
        // du job outline (voir /api/courses POST). Champ hors schéma partagé,
        // ignoré silencieusement par createCourseInputSchema côté validation.
        body: JSON.stringify({
          ...result.data,
          importsMaterial: Boolean(options.sourceMaterialFile),
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | { id?: string; error?: string; code?: string }
        | null;

      // Quota du plan atteint : toast avec CTA vers les offres.
      if (response.status === 402 || data?.code === 'quota_exceeded') {
        toast({
          title: 'Quota mensuel atteint',
          description:
            data?.error ?? 'Passez à un plan supérieur pour créer davantage de cours.',
          variant: 'warning',
          duration: 8000,
          action: { label: 'Voir les offres', onClick: () => router.push('/pricing') },
        });
        return;
      }

      if (!response.ok || !data?.id) {
        toast({
          title: 'La création a échoué',
          description: data?.error ?? 'Réessayez dans un instant.',
          variant: 'danger',
        });
        return;
      }

      // Import de contenu existant (P90) : le cours vient d'obtenir un id,
      // on peut maintenant uploader le support choisi. Best-effort — un
      // échec d'upload ne bloque jamais la création du cours (juste un toast).
      if (options.sourceMaterialFile) {
        try {
          const materialForm = new FormData();
          materialForm.append('file', options.sourceMaterialFile);
          const materialResponse = await fetch(`/api/courses/${data.id}/import-material`, {
            method: 'POST',
            body: materialForm,
          });
          if (!materialResponse.ok) {
            toast({
              title: 'Support source non importé',
              description: 'Le cours a été créé, mais le fichier n’a pas pu être importé.',
              variant: 'warning',
            });
          }
        } catch {
          toast({
            title: 'Support source non importé',
            description: 'Le cours a été créé, mais le fichier n’a pas pu être importé.',
            variant: 'warning',
          });
        }
      }

      // Acte 2 : transition cinématique existante, puis page du cours.
      setPhase('generating');
      redirectTimerRef.current = window.setTimeout(() => {
        router.push(`/dashboard/courses/${data.id}`);
      }, REDIRECT_AFTER_MS);
    } catch {
      toast({
        title: 'Connexion impossible',
        description: 'Vérifiez votre réseau puis réessayez.',
        variant: 'danger',
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Acte 2 — le titre voyage vers l'en-tête via le layoutId partagé.
  if (phase === 'generating' && difficulty) {
    return (
      <main className="min-h-dvh bg-background">
        <GenerationScreen
          title={title}
          difficulty={difficulty}
          options={options}
          onBack={() => {
            // Retour au brief : on annule la redirection programmée.
            if (redirectTimerRef.current !== null) {
              window.clearTimeout(redirectTimerRef.current);
              redirectTimerRef.current = null;
            }
            setPhase('compose');
          }}
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
          <Button
            variant="gold"
            size="lg"
            loading={submitting}
            onClick={handleSubmit}
            className="w-full sm:w-auto"
          >
            {!submitting && <Wand2 aria-hidden="true" />}
            {submitting ? 'Création du cours…' : 'Générer mon cours'}
          </Button>
        </motion.div>
      </div>
    </main>
  );
}
