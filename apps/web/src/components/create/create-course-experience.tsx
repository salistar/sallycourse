'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import { Wand2 } from 'lucide-react';
// Sous-modules directs (et non le barrel @sallycourse/shared) : le barrel
// réexporte crypto.ts (node:crypto), incompatible avec le bundle client.
import { createCourseInputSchema, type Difficulty, type AdvancedParams } from '@sallycourse/shared/schemas/course';
import type { DictationBrief } from '@sallycourse/shared/voice-intent';
import { estimateCourseVolume, estimateCourseCost } from '@sallycourse/shared/course-estimate';
import { LLM_PROVIDER_CATALOG } from '@sallycourse/shared/llm-providers';
import { getCourseTemplate, type CourseTemplate } from '@sallycourse/shared/course-templates';
import { Button, useToast } from '@/components/ui';
import { errorMessage } from '@/lib/error-message';
import { transitions } from '@/components/motion/motion-config';
import { TitleField } from './title-field';
import { TitleSuggestions } from './title-suggestions';
import { buildTitleSuggestions } from './mock-title-suggestions';
import { LevelSelector } from './level-selector';
import { VoiceDictation } from './voice-dictation';
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

/** Mappe les issues zod du schéma partagé vers des CLÉS i18n (résolues au rendu). */
function toFieldErrors(error: import('zod').ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (field === 'title' && !errors.title) {
      errors.title = issue.code === 'too_big' ? 'errorTitleTooLong' : 'errorTitleTooShort';
    }
    if (field === 'difficulty' && !errors.difficulty) {
      errors.difficulty = 'errorLevelRequired';
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

/** Formatte un USD compact (2 décimales, ou le libellé « gratuit » traduit si ~0). */
function formatUsd(v: number, freeLabel: string): string {
  if (v < 0.005) return freeLabel;
  return `~${v.toFixed(2)} $`;
}

/**
 * Modèle LLM représentatif par provider choisi (pour le DEVIS coût). Les
 * gratuits (Gemini, GLM Flash) et l'OSS local reviennent à 0 ; les payants
 * pointent sur un modèle facturé de leur famille (voir pricing-table).
 */
const ESTIMATE_LLM_MODEL: Record<string, string> = {
  auto: 'gemini-flash-latest',
  gemini: 'gemini-flash-latest',
  zhipu: 'glm-4.5-flash',
  ollama: 'gemini-flash-latest',
  oss: 'gemini-flash-latest',
  deepseek: 'deepseek-chat',
  cloudflare: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  xai: 'grok-3-mini',
  dashscope: 'qwen-plus',
  moonshot: 'moonshot-v1-8k',
  minimax: 'MiniMax-M2',
  anthropic: 'claude-sonnet-5',
};

/**
 * Récap devis AVANT génération (Phase 10, P173) : volume estimé (leçons/vidéos/
 * durée) + coût estimé (selon le provider choisi vs OSS). 100 % client (pur),
 * recalculé sur les paramètres — le temps précis (historique) n'est pas inclus ici.
 */
function GenerationEstimateLine({
  approxSections,
  advancedParams,
  llmProvider,
}: {
  approxSections: number | undefined;
  advancedParams: AdvancedParams;
  llmProvider: string;
}) {
  const t = useTranslations('create.experience');
  const { volume, cost } = React.useMemo(() => {
    const v = estimateCourseVolume({
      approxSections,
      targetHours: advancedParams.targetHours,
      avgVideoLength: advancedParams.avgVideoLength,
      contentRatio: advancedParams.contentRatio,
      narrationSpeed: advancedParams.narrationSpeed,
    });
    // Modèle LLM représentatif du provider choisi (défaut : Gemini gratuit).
    const llmModel = ESTIMATE_LLM_MODEL[llmProvider] ?? 'gemini-flash-latest';
    const c = estimateCourseCost(v, { llmModel, ttsProvider: 'edge' });
    return { volume: v, cost: c };
  }, [approxSections, advancedParams, llmProvider]);

  return (
    <p className="text-center text-2xs text-muted sm:text-start" aria-live="polite">
      {t.rich('estimate', {
        lessons: volume.lessons,
        videos: volume.videos,
        minutes: volume.totalVideoMinutes,
        cloudCost: formatUsd(cost.cloudUsd, t('free')),
        ossCost: formatUsd(cost.ossUsd, t('free')),
        strong: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
      })}
    </p>
  );
}

/** Un preset de génération (forme exposée par /api/generation-presets). */
interface GenerationPreset {
  id: string;
  name: string;
  params: Record<string, unknown>;
}

/**
 * Barre de presets de génération (Phase 10, P163/174) : charge un jeu de
 * paramètres sauvegardé (« mes réglages DevOps ») en un clic, ou enregistre la
 * configuration courante sous un nom. 100 % client, API /api/generation-presets.
 */
function GenerationPresetBar({
  buildParams,
  onApply,
}: {
  buildParams: () => Record<string, unknown>;
  onApply: (params: Record<string, unknown>) => void;
}) {
  const { toast } = useToast();
  const t = useTranslations('create.experience');
  const [presets, setPresets] = React.useState<GenerationPreset[]>([]);
  const [saving, setSaving] = React.useState(false);
  // Dernier preset appliqué — cible du bouton de suppression (DELETE
  // /api/generation-presets/[id], route sans appelant avant l'audit 2026-07-17).
  const [lastApplied, setLastApplied] = React.useState<GenerationPreset | null>(null);

  const reload = React.useCallback(async () => {
    try {
      const res = await fetch('/api/generation-presets');
      const data = (await res.json().catch(() => null)) as
        | { presets?: GenerationPreset[]; publicPresets?: GenerationPreset[] }
        | null;
      if (data) setPresets([...(data.presets ?? []), ...(data.publicPresets ?? [])]);
    } catch {
      /* réseau indisponible — barre simplement vide */
    }
  }, []);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const save = async () => {
    const name = window.prompt(t('presetNamePrompt'))?.trim();
    if (!name) return;
    setSaving(true);
    try {
      const res = await fetch('/api/generation-presets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, params: buildParams() }),
      });
      if (res.ok) {
        toast({ title: t('presetSaved'), description: name, variant: 'success' });
        await reload();
      } else {
        toast({ title: t('presetSaveFailed'), variant: 'danger' });
      }
    } catch {
      toast({ title: t('networkError'), variant: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex w-full flex-wrap items-center justify-center gap-2 text-xs sm:justify-start">
      {presets.length > 0 && (
        <select
          aria-label={t('loadPresetAriaLabel')}
          defaultValue=""
          onChange={(e) => {
            const p = presets.find((x) => x.id === e.target.value);
            if (p) {
              onApply(p.params);
              setLastApplied(p);
              toast({ title: t('presetApplied'), description: p.name, variant: 'success' });
            }
            e.target.value = '';
          }}
          className="rounded-sm border border-input bg-surface px-2 py-1 text-xs text-foreground"
        >
          <option value="">{t('loadPresetOption')}</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      <Button variant="ghost" size="sm" loading={saving} onClick={() => void save()}>
        {t('saveAsPreset')}
      </Button>
      {lastApplied && (
        <Button
          variant="ghost"
          size="sm"
          className="text-danger hover:bg-danger/10"
          onClick={() => {
            void (async () => {
              if (!window.confirm(t('deletePresetConfirm', { name: lastApplied.name }))) return;
              try {
                const res = await fetch(`/api/generation-presets/${lastApplied.id}`, { method: 'DELETE' });
                if (!res.ok) {
                  toast({ title: t('presetDeleteFailed'), variant: 'danger' });
                  return;
                }
                toast({ title: t('presetDeleted'), description: lastApplied.name, variant: 'success' });
                setLastApplied(null);
                await reload();
              } catch {
                toast({ title: t('networkError'), variant: 'danger' });
              }
            })();
          }}
        >
          {t('deletePresetButton', { name: lastApplied.name.slice(0, 24) })}
        </Button>
      )}
    </div>
  );
}

export function CreateCourseExperience(props: CreateCourseExperienceProps = {}) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useTranslations('create.experience');
  const tApiError = useTranslations('apiErrors');
  const [phase, setPhase] = React.useState<Phase>('compose');
  const [submitting, setSubmitting] = React.useState(false);

  // Brief initial dérivé d'un éventuel template (?template=…).
  const initial = React.useMemo(() => deriveInitialBrief(props), [props.initialTemplateId, props.initialTitle]);

  // Brief du cours
  const [title, setTitle] = React.useState(initial.title);
  const [difficulty, setDifficulty] = React.useState<Difficulty | null>(initial.difficulty);
  const [options, setOptions] = React.useState<AdvancedOptions>(initial.options);
  // Mode d'enchaînement de la génération : automatique (défaut) ou validé
  // leçon par leçon (la chaîne attend la relecture de l'auteur).
  const [generationMode, setGenerationMode] = React.useState<'auto' | 'validated'>('auto');
  // Provider LLM (moteur de rédaction) — 'auto' = cascade coût optimisée
  // (cloud gratuit d'abord). Voir worker/providers/cloud-llm.ts.
  const [llmProvider, setLlmProvider] = React.useState('auto');
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
   * Applique un brief DICTÉ (Prompt 210) au formulaire : pré-remplit titre,
   * niveau, locale et — si exprimés — nombre de sections et public visé.
   * L'auteur reste libre de tout ajuster ensuite (la dictée n'auto-soumet pas).
   */
  const applyDictationBrief = (brief: DictationBrief) => {
    suppressSuggestionsRef.current = true;
    setTitle(brief.title);
    setDifficulty(brief.difficulty);
    setOptions((prev) => ({
      ...prev,
      locale: brief.locale,
      ...(brief.approxSections ? { approxSections: brief.approxSections } : {}),
      advancedParams: brief.audience
        ? { ...prev.advancedParams, audience: brief.audience }
        : prev.advancedParams,
    }));
    setErrors({});
  };

  // ── Presets de génération (P163/174) — capture / application des paramètres ──
  const buildPresetParams = (): Record<string, unknown> => ({
    ...(difficulty ? { difficulty } : {}),
    generationMode,
    ...(llmProvider !== 'auto' ? { llmProvider } : {}),
    locale: options.locale,
    ttsVoice: options.ttsVoice,
    ttsEngine: options.ttsEngine,
    voiceId: options.voiceId,
    themeId: options.themeId,
    imageEngine: options.imageEngine,
    targetPlatforms: options.targetPlatforms,
    approxSections: options.approxSections,
    avatarEnabled: options.avatarEnabled,
    avatarId: options.avatarId,
    useCustomVoice: options.useCustomVoice,
    ...(Object.keys(options.advancedParams).length > 0 ? { advancedParams: options.advancedParams } : {}),
  });

  const applyPreset = (p: Record<string, unknown>) => {
    if (p.difficulty) setDifficulty(p.difficulty as Difficulty);
    if (p.generationMode === 'auto' || p.generationMode === 'validated') setGenerationMode(p.generationMode);
    if (typeof p.llmProvider === 'string') setLlmProvider(p.llmProvider);
    setOptions((prev) => ({
      ...prev,
      locale: (p.locale as AdvancedOptions['locale']) ?? prev.locale,
      ttsVoice: (p.ttsVoice as string) ?? prev.ttsVoice,
      ttsEngine: (p.ttsEngine as AdvancedOptions['ttsEngine']) ?? prev.ttsEngine,
      voiceId: (p.voiceId as string) ?? prev.voiceId,
      themeId: (p.themeId as string) ?? prev.themeId,
      imageEngine: (p.imageEngine as AdvancedOptions['imageEngine']) ?? prev.imageEngine,
      targetPlatforms: (p.targetPlatforms as string[]) ?? prev.targetPlatforms,
      approxSections: (p.approxSections as number) ?? prev.approxSections,
      avatarEnabled: (p.avatarEnabled as boolean) ?? prev.avatarEnabled,
      avatarId: (p.avatarId as string) ?? prev.avatarId,
      useCustomVoice: (p.useCustomVoice as boolean) ?? prev.useCustomVoice,
      advancedParams: (p.advancedParams as AdvancedParams) ?? prev.advancedParams,
    }));
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
      generationMode,
      ...(llmProvider !== 'auto' ? { llmProvider } : {}),
      locale: options.locale,
      ttsVoice: options.ttsVoice,
      ttsEngine: options.ttsEngine,
      // Voix du catalogue : '' = défaut de la langue → on omet (zod enum).
      ...(options.voiceId ? { voiceId: options.voiceId } : {}),
      // Thème : '' = défaut « salistar » → on omet (zod enum).
      ...(options.themeId ? { themeId: options.themeId } : {}),
      imageEngine: options.imageEngine,
      targetPlatforms: options.targetPlatforms,
      approxSections: options.approxSections,
      avatarEnabled: options.avatarEnabled,
      avatarId: options.avatarEnabled ? options.avatarId : undefined,
      useCustomVoice: options.useCustomVoice,
      scheduleOffPeak: options.scheduleOffPeak,
      // Paramètres de génération avancés (Phase 10) — envoyés seulement si l'auteur
      // en a renseigné au moins un (sinon comportement simple par défaut).
      ...(Object.keys(options.advancedParams).length > 0 ? { advancedParams: options.advancedParams } : {}),
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
          // Mode agence (P150) : contexte client actif choisi dans
          // dashboard/agency (persisté localStorage), repris ici pour rattacher
          // le cours au bon client. Absent pour tout utilisateur non-agence.
          ...(typeof window !== 'undefined' && window.localStorage.getItem('sc_agency_active_client')
            ? { agencyClientId: window.localStorage.getItem('sc_agency_active_client') }
            : {}),
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | {
            id?: string;
            error?: string;
            code?: string;
            scheduledFor?: string;
            similarityWarning?: { courseTitle: string; score: number };
          }
        | null;

      // Quota du plan atteint : toast avec CTA vers les offres.
      if (response.status === 402 || data?.code === 'quota_exceeded') {
        toast({
          title: t('quotaTitle'),
          description: errorMessage(data, tApiError),
          variant: 'warning',
          duration: 8000,
          action: { label: t('viewPlans'), onClick: () => router.push('/pricing') },
        });
        return;
      }

      if (!response.ok || !data?.id) {
        toast({
          title: t('createFailedTitle'),
          description: errorMessage(data, tApiError),
          variant: 'danger',
        });
        return;
      }

      // Déduplication (P115) : un cours très proche existe déjà. Informatif —
      // la génération continue, mais on prévient (le backend le renvoyait sans
      // que rien ne l'affiche jusqu'ici).
      if (data.similarityWarning) {
        toast({
          title: t('similarCourseTitle'),
          description: t('similarCourseDescription', { courseTitle: data.similarityWarning.courseTitle }),
          variant: 'warning',
          duration: 8000,
        });
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
              title: t('materialNotImportedTitle'),
              description: t('materialNotImportedDescription'),
              variant: 'warning',
            });
          }
        } catch {
          toast({
            title: t('materialNotImportedTitle'),
            description: t('materialNotImportedDescription'),
            variant: 'warning',
          });
        }
      }

      // Programmation en heures creuses (P134) : la génération démarrera plus
      // tard — on informe l'utilisateur avant la redirection.
      if (data.scheduledFor) {
        const hhmm = new Date(data.scheduledFor).toLocaleTimeString('fr-FR', {
          hour: '2-digit',
          minute: '2-digit',
        });
        toast({
          title: t('scheduledTitle'),
          description: t('scheduledDescription', { time: hhmm }),
          variant: 'success',
        });
      }

      // Acte 2 : transition cinématique existante, puis page du cours.
      setPhase('generating');
      redirectTimerRef.current = window.setTimeout(() => {
        router.push(`/dashboard/courses/${data.id}`);
      }, REDIRECT_AFTER_MS);
    } catch {
      toast({
        title: t('connectionFailedTitle'),
        description: t('connectionFailedDescription'),
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
          {t('eyebrow')}
        </motion.p>

        {/* Le titre : très grande typographie display, layoutId partagé */}
        <motion.div layoutId={COURSE_TITLE_LAYOUT_ID} transition={transitions.springSoft} className="w-full">
          <TitleField
            value={title}
            onChange={handleTitleChange}
            error={errors.title ? t(errors.title) : undefined}
            onEnter={handleSubmit}
          />
        </motion.div>

        <TitleSuggestions suggestions={suggestions} onPick={handlePickSuggestion} />

        {/* Dictée vocale (P210) — décrire le cours à l'oral (fr/darija/arabe). */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...transitions.enter, delay: 0.1 }}
          className="w-full"
        >
          <VoiceDictation onBrief={applyDictationBrief} />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...transitions.enter, delay: 0.15 }}
          className="w-full"
        >
          <p className="mb-4 text-center text-2xs font-semibold uppercase tracking-widest text-muted">
            {t('whichLevel')}
          </p>
          <LevelSelector value={difficulty} onChange={handleLevelChange} error={errors.difficulty ? t(errors.difficulty) : undefined} />
        </motion.div>

        {/* Mode d'enchaînement : tout générer d'un coup, ou valider chaque leçon. */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...transitions.enter, delay: 0.2 }}
          className="w-full"
        >
          <div
            role="radiogroup"
            aria-label={t('generationModeAriaLabel')}
            className="mx-auto flex w-full max-w-xl flex-col gap-2 sm:flex-row"
          >
            {(
              [
                {
                  id: 'auto' as const,
                  label: t('autoModeLabel'),
                  hint: t('autoModeHint'),
                },
                {
                  id: 'validated' as const,
                  label: t('validatedModeLabel'),
                  hint: t('validatedModeHint'),
                },
              ]
            ).map((mode) => (
              <button
                key={mode.id}
                type="button"
                role="radio"
                aria-checked={generationMode === mode.id}
                onClick={() => setGenerationMode(mode.id)}
                className={`flex-1 rounded-lg border px-4 py-3 text-left transition-colors ${
                  generationMode === mode.id
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-surface hover:border-primary/50'
                }`}
              >
                <span className="block text-sm font-semibold text-foreground">{mode.label}</span>
                <span className="mt-0.5 block text-xs text-muted">{mode.hint}</span>
              </button>
            ))}
          </div>

          {/* Moteur de rédaction (provider LLM) — 'auto' = cascade coût optimisée. */}
          <div className="mx-auto mt-3 flex w-full max-w-xl items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-2.5">
            <label htmlFor="llm-provider" className="text-sm text-muted">
              {t('writingEngine')}
            </label>
            <select
              id="llm-provider"
              value={llmProvider}
              onChange={(e) => setLlmProvider(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground"
            >
              {LLM_PROVIDER_CATALOG.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </motion.div>

        {/* Presets de génération (Phase 10, P163/174) */}
        <GenerationPresetBar buildParams={buildPresetParams} onApply={applyPreset} />

        {/* Devis avant génération (Phase 10, P173) */}
        <GenerationEstimateLine
          approxSections={options.approxSections}
          advancedParams={options.advancedParams}
          llmProvider={llmProvider}
        />

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
            {submitting ? t('submitting') : t('submit')}
          </Button>
        </motion.div>
      </div>
    </main>
  );
}
