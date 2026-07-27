'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, FileText, Minus, Plus, SlidersHorizontal, Upload, X } from 'lucide-react';
// Sous-modules directs (et non le barrel @sallycourse/shared) : le barrel
// réexporte crypto.ts (node:crypto), incompatible avec le bundle client.
import { computeNextOffPeakStart } from '@sallycourse/shared/off-peak-window';
import { detectSourceMaterialKind } from '@sallycourse/shared/rag';
import { VOICE_CATALOG, resolveCatalogVoice } from '@sallycourse/shared/voice-catalog';
import { THEME_CATALOG } from '@sallycourse/shared/theme-catalog';
import { AVATAR_CATALOG } from '@sallycourse/shared/avatar-catalog';
import type { Locale } from '@sallycourse/shared/constants';
import type { AdvancedParams } from '@sallycourse/shared/schemas/course';
import { cn } from '@/lib/cn';
import { Button, Select } from '@/components/ui';
import { transitions } from '@/components/motion/motion-config';

/**
 * Panneau latéral « Options avancées » — replié par défaut derrière un
 * déclencheur discret ; s'ouvre en volet coulissant côté inline-end
 * (backdrop flouté, Échap et clic extérieur pour fermer, focus restauré).
 * Les valeurs alimentent createCourseInputSchema (locale, ttsVoice,
 * targetPlatforms, approxSections).
 */

/* ------------------------------------------------------------------ */
/* Modèle des options                                                  */
/* ------------------------------------------------------------------ */

export interface AdvancedOptions {
  locale: Locale;
  ttsVoice: string;
  /**
   * Moteur de voix premium préféré (audit qualité modèles 2026-07-22, additif) —
   * voir Course.ttsEngine. 'chatterbox' = défaut historique.
   */
  ttsEngine: 'chatterbox' | 'qwen3';
  /**
   * Voix de narration du catalogue (fix « voix multiples » 2026-07-26) — id de
   * VOICE_CATALOG, '' = voix par défaut de la langue du cours. L'identité
   * choisie est ÉPINGLÉE sur toutes les vidéos du cours (une seule voix).
   */
  voiceId: string;
  /**
   * Thème visuel des slides et articles (catalogue 2026-07-26) — id de
   * THEME_CATALOG, '' = « salistar » (défaut historique). Modifiable après
   * génération depuis la page du cours (re-rendu des vidéos).
   */
  themeId: string;
  /**
   * Moteur d'image premium préféré (audit qualité modèles 2026-07-22, additif) —
   * voir Course.imageEngine. 'sdxl' = défaut historique.
   */
  imageEngine: 'sdxl' | 'zimage';
  targetPlatforms: string[];
  approxSections: number;
  /** Avatar vidéo (P82, bêta) — segment « talking head » en intro/conclusion de section. */
  avatarEnabled: boolean;
  /** Avatar HeyGen choisi — ignoré si avatarEnabled=false. */
  avatarId: string;
  /** Voix clonée personnalisée (Chatterbox/Modal) — narre avec la voix de l'auteur. */
  useCustomVoice: boolean;
  /** Paramètres de génération avancés (Phase 10, P163-174) — structure/pédagogie/domaine. */
  advancedParams: AdvancedParams;
  /**
   * Import de contenu existant (Prompt 90, RAG simple) — support source
   * (PDF/PPTX/Markdown) choisi par l'utilisateur, uploadé APRÈS la création
   * du cours (POST /api/courses/[id]/import-material, le cours n'a pas
   * encore d'id au moment de ce choix). Transitoire : jamais envoyé dans
   * createCourseInputSchema, ni persisté tel quel côté état.
   */
  sourceMaterialFile: File | null;
  /**
   * Programmer la génération en heures creuses (P134, 2h-6h) — le job
   * outline est enfilé avec un délai BullMQ jusqu'à la prochaine fenêtre
   * creuse au lieu de démarrer immédiatement.
   */
  scheduleOffPeak: boolean;
}

/**
 * Avatars présentateurs (catalogue 2026-07-26) : vrais avatars animés par
 * Ditto — le portrait de chaque avatar est généré par le pipeline image du
 * produit et mis en cache storage (voir avatar-catalog.ts + worker
 * ensureCatalogAvatarPhoto). Remplace la maquette HeyGen (ids legacy
 * « heygen-avatar-* » toujours acceptés en base).
 */
export const AVATAR_OPTIONS = AVATAR_CATALOG.map((a) => ({
  id: a.id,
  label: `${a.name} (${a.gender === 'female' ? '♀' : '♂'})`,
}));

/** Voix TTS disponibles — maquette locale, remplacée plus tard par l'API. */
export const TTS_VOICES = [
  { id: 'sally-fr-claire', label: 'Claire — chaleureuse (FR)' },
  { id: 'sally-fr-marc', label: 'Marc — posée (FR)' },
  { id: 'sally-en-ava', label: 'Ava — dynamique (EN)' },
  { id: 'sally-en-noah', label: 'Noah — narratif (EN)' },
  { id: 'sally-ar-yasmine', label: 'Yasmine — عربية فصحى (AR)' },
] as const;

/** Plateformes de publication ciblées. */
export const TARGET_PLATFORMS = [
  { id: 'udemy', label: 'Udemy' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'skillshare', label: 'Skillshare' },
  { id: 'podia', label: 'Podia' },
] as const;

const COURSE_LOCALES: ReadonlyArray<{ value: Locale; label: string }> = [
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'العربية' },
];

/** Bornes du nombre de sections — miroir de createCourseInputSchema. */
const SECTIONS_MIN = 3;
const SECTIONS_MAX = 30;

/** Jour (aujourd'hui/demain, traduit) + heure du prochain créneau creux (P134). */
function formatOffPeakSlot(now: Date, todayLabel: string, tomorrowLabel: string): { day: string; time: string } {
  const next = computeNextOffPeakStart(now);
  const hh = String(next.getHours()).padStart(2, '0');
  const mm = String(next.getMinutes()).padStart(2, '0');
  const sameDay = next.toDateString() === now.toDateString();
  return { day: sameDay ? todayLabel : tomorrowLabel, time: `${hh}:${mm}` };
}

export const DEFAULT_ADVANCED_OPTIONS: AdvancedOptions = {
  locale: 'fr',
  // Vide = voix synthétique par défaut de la langue (résolue par la cascade TTS).
  ttsVoice: '',
  ttsEngine: 'chatterbox',
  // '' = voix par défaut de la langue du cours (catalogue, résolue côté worker).
  voiceId: '',
  // '' = thème par défaut « salistar » (rendu identique à l'historique).
  themeId: '',
  imageEngine: 'sdxl',
  targetPlatforms: ['udemy'],
  approxSections: 8,
  avatarEnabled: false,
  avatarId: AVATAR_OPTIONS[0]?.id ?? 'clara',
  useCustomVoice: false,
  advancedParams: {},
  sourceMaterialFile: null,
  scheduleOffPeak: false,
};

/* ------------------------------------------------------------------ */
/* Sous-composants internes                                            */
/* ------------------------------------------------------------------ */

/** Petit champ texte labellisé (style aligné sur les Select du panneau). */
function TextField({
  label,
  hint,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  const id = React.useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="px-1 text-xs font-semibold text-muted">
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'w-full rounded-sm border border-input bg-surface px-3 py-2 text-sm text-foreground shadow-sm',
          'placeholder:text-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80',
        )}
      />
      {hint && <span className="px-1 text-2xs text-muted/80">{hint}</span>}
    </div>
  );
}

/**
 * Section « Paramètres de génération avancés » (Phase 10, P163-166) : structure,
 * pédagogie et domaine expert. Chaque contrôle a une valeur « Par défaut »
 * (= laisse l'IA décider). Les listes (mots-clés / exclusions) sont saisies en
 * texte séparé par des virgules et converties en tableau.
 */
function GenerationParamsSection({
  value,
  onChange,
}: {
  value: AdvancedParams;
  onChange: (v: AdvancedParams) => void;
}) {
  const t = useTranslations('create.advanced');
  const set = (patch: Partial<AdvancedParams>) => onChange({ ...value, ...patch });
  const csv = (arr: readonly string[] | undefined) => (arr ?? []).join(', ');
  const toArr = (s: string) => {
    const items = s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    return items.length > 0 ? items : undefined;
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Structure (P164) */}
      <fieldset className="flex flex-col gap-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">{t('genStructureLegend')}</legend>
        <Select
          label={t('genTargetHoursLabel')}
          value={value.targetHours ? String(value.targetHours) : ''}
          onChange={(e) => set({ targetHours: e.target.value ? Number(e.target.value) : undefined })}
        >
          <option value="">{t('genTargetHoursDefault')}</option>
          <option value="1">{t('genTargetHours1')}</option>
          <option value="3">{t('genTargetHours3')}</option>
          <option value="6">{t('genTargetHours6')}</option>
          <option value="10">{t('genTargetHours10')}</option>
        </Select>
        <Select
          label={t('genAvgVideoLabel')}
          value={value.avgVideoLength ?? ''}
          onChange={(e) => set({ avgVideoLength: (e.target.value || undefined) as AdvancedParams['avgVideoLength'] })}
        >
          <option value="">{t('genDefault')}</option>
          <option value="3-5">{t('genAvgVideoShort')}</option>
          <option value="5-8">{t('genAvgVideoMedium')}</option>
          <option value="8-12">{t('genAvgVideoLong')}</option>
        </Select>
        <Select
          label={t('genQuizPositionLabel')}
          value={value.quizPosition ?? ''}
          onChange={(e) => set({ quizPosition: (e.target.value || undefined) as AdvancedParams['quizPosition'] })}
        >
          <option value="">{t('genDefault')}</option>
          <option value="per-section">{t('genQuizPerSection')}</option>
          <option value="mid-course">{t('genQuizMidCourse')}</option>
          <option value="final-only">{t('genQuizFinalOnly')}</option>
        </Select>
        <Select
          label={t('genProjectModeLabel')}
          value={value.projectMode ?? ''}
          onChange={(e) => set({ projectMode: (e.target.value || undefined) as AdvancedParams['projectMode'] })}
        >
          <option value="">{t('genDefault')}</option>
          <option value="fil-rouge">{t('genProjectFilRouge')}</option>
          <option value="independent">{t('genProjectIndependent')}</option>
        </Select>
        <ToggleSwitch
          label={t('genFinalExamLabel')}
          hint={t('genFinalExamHint')}
          checked={Boolean(value.finalExam)}
          onToggle={() => set({ finalExam: !value.finalExam })}
        />
        {value.finalExam && (
          <Select
            label={t('genPassingScoreLabel')}
            value={String(value.finalExamPassingScore ?? '')}
            onChange={(e) =>
              set({ finalExamPassingScore: e.target.value ? Number.parseInt(e.target.value, 10) : undefined })
            }
          >
            <option value="">{t('genPassingScoreDefault')}</option>
            {[50, 60, 70, 80, 90].map((s) => (
              <option key={s} value={s}>
                {s} %
              </option>
            ))}
          </Select>
        )}
        <TextField
          label={t('genContentRatioLabel')}
          hint={t('genContentRatioHint')}
          value={
            value.contentRatio
              ? [value.contentRatio.video, value.contentRatio.article, value.contentRatio.tp, value.contentRatio.quiz].join(',')
              : ''
          }
          placeholder="40,25,20,15"
          onChange={(v) => {
            const parts = v.split(',').map((p) => Number.parseInt(p.trim(), 10));
            if (parts.length === 4 && parts.every((n) => Number.isFinite(n) && n >= 0 && n <= 100)) {
              set({ contentRatio: { video: parts[0]!, article: parts[1]!, tp: parts[2]!, quiz: parts[3]! } });
            } else if (!v.trim()) {
              set({ contentRatio: undefined });
            }
          }}
        />
      </fieldset>

      {/* Pédagogie (P165) */}
      <fieldset className="flex flex-col gap-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">{t('genPedagogyLegend')}</legend>
        <Select
          label={t('genToneLabel')}
          value={value.tone ?? ''}
          onChange={(e) => set({ tone: (e.target.value || undefined) as AdvancedParams['tone'] })}
        >
          <option value="">{t('genDefault')}</option>
          <option value="academic">{t('genToneAcademic')}</option>
          <option value="conversational">{t('genToneConversational')}</option>
          <option value="energetic">{t('genToneEnergetic')}</option>
        </Select>
        <Select
          label={t('genDensityLabel')}
          value={value.density ?? ''}
          onChange={(e) => set({ density: (e.target.value || undefined) as AdvancedParams['density'] })}
        >
          <option value="">{t('genDefault')}</option>
          <option value="concise">{t('genDensityConcise')}</option>
          <option value="normal">{t('genDensityNormal')}</option>
          <option value="detailed">{t('genDensityDetailed')}</option>
        </Select>
        <Select
          label={t('genApproachLabel')}
          value={value.approach ?? ''}
          onChange={(e) => set({ approach: (e.target.value || undefined) as AdvancedParams['approach'] })}
        >
          <option value="">{t('genDefault')}</option>
          <option value="theory-first">{t('genApproachTheory')}</option>
          <option value="examples-first">{t('genApproachExamples')}</option>
          <option value="practice-first">{t('genApproachPractice')}</option>
        </Select>
        <Select
          label={t('genObjectiveLabel')}
          value={value.objective ?? ''}
          onChange={(e) => set({ objective: (e.target.value || undefined) as AdvancedParams['objective'] })}
        >
          <option value="">{t('genDefault')}</option>
          <option value="certification">{t('genObjectiveCertification')}</option>
          <option value="career-change">{t('genObjectiveCareerChange')}</option>
          <option value="upskilling">{t('genObjectiveUpskilling')}</option>
        </Select>
        <ToggleSwitch
          label={t('genAnalogiesLabel')}
          checked={Boolean(value.analogies)}
          onToggle={() => set({ analogies: !value.analogies })}
        />
        <TextField
          label={t('genAudienceLabel')}
          hint={t('genAudienceHint')}
          value={value.audience ?? ''}
          placeholder={t('genAudiencePlaceholder')}
          onChange={(v) => set({ audience: v.trim() ? v : undefined })}
        />
        <ToggleSwitch
          label={t('genSpacedRepetitionLabel')}
          hint={t('genSpacedRepetitionHint')}
          checked={Boolean(value.spacedRepetition)}
          onToggle={() => set({ spacedRepetition: !value.spacedRepetition })}
        />
      </fieldset>

      {/* Domaine expert (P166) */}
      <fieldset className="flex flex-col gap-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">{t('genDomainLegend')}</legend>
        <TextField
          label={t('genMandatoryKeywordsLabel')}
          hint={t('genCommaHint')}
          value={csv(value.mandatoryKeywords)}
          placeholder={t('genMandatoryKeywordsPlaceholder')}
          onChange={(v) => set({ mandatoryKeywords: toArr(v) })}
        />
        <TextField
          label={t('genExcludedTopicsLabel')}
          hint={t('genCommaHint')}
          value={csv(value.excludedTopics)}
          placeholder={t('genExcludedTopicsPlaceholder')}
          onChange={(v) => set({ excludedTopics: toArr(v) })}
        />
        <TextField
          label={t('genImposedToolsLabel')}
          value={value.imposedTools ?? ''}
          placeholder={t('genImposedToolsPlaceholder')}
          onChange={(v) => set({ imposedTools: v.trim() ? v : undefined })}
        />
        <Select
          label={t('genTpOsLabel')}
          value={value.tpOs ?? ''}
          onChange={(e) => set({ tpOs: (e.target.value || undefined) as AdvancedParams['tpOs'] })}
        >
          <option value="">{t('genDefault')}</option>
          <option value="windows">Windows</option>
          <option value="linux">Linux</option>
          <option value="macos">macOS</option>
          <option value="web">{t('genTpOsWeb')}</option>
          <option value="any">{t('genTpOsAny')}</option>
        </Select>
        <TextField
          label={t('genCodeCommentLangLabel')}
          value={value.codeCommentLang ?? ''}
          placeholder={t('genCodeCommentLangPlaceholder')}
          onChange={(v) => set({ codeCommentLang: v.trim() ? v : undefined })}
        />
        <TextField
          label={t('genCertificationTargetLabel')}
          hint={t('genCertificationTargetHint')}
          value={value.certificationTarget ?? ''}
          placeholder={t('genCertificationTargetPlaceholder')}
          onChange={(v) => set({ certificationTarget: v.trim() ? v : undefined })}
        />
        <TextField
          label={t('genGlossaryLabel')}
          hint={t('genGlossaryHint')}
          value={value.glossary ?? ''}
          placeholder={t('genGlossaryPlaceholder')}
          onChange={(v) => set({ glossary: v.trim() ? v.slice(0, 2000) : undefined })}
        />
      </fieldset>

      {/* Voix & vidéo (P167) */}
      <fieldset className="flex flex-col gap-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">{t('genVoiceVideoLegend')}</legend>
        <Select
          label={t('genNarrationSpeedLabel')}
          value={value.narrationSpeed ? String(value.narrationSpeed) : ''}
          onChange={(e) => set({ narrationSpeed: e.target.value ? Number(e.target.value) : undefined })}
        >
          <option value="">{t('genNarrationSpeedDefault')}</option>
          <option value="0.9">{t('genNarrationSpeedSlow')}</option>
          <option value="1">{t('genNarrationSpeedStandard')}</option>
          <option value="1.1">{t('genNarrationSpeedDynamic')}</option>
          <option value="1.25">{t('genNarrationSpeedFast')}</option>
        </Select>
        <Select
          label={t('genSlideLanguageLabel')}
          hint={t('genSlideLanguageHint')}
          value={value.slideLanguage ?? ''}
          onChange={(e) => set({ slideLanguage: (e.target.value || undefined) as AdvancedParams['slideLanguage'] })}
        >
          <option value="">{t('genSlideLanguageSame')}</option>
          <option value="fr">Français</option>
          <option value="en">English</option>
          <option value="ar">العربية</option>
        </Select>
        <ToggleSwitch
          label={t('genVerticalLabel')}
          hint={t('genVerticalHint')}
          checked={Boolean(value.generateVertical)}
          onToggle={() => set({ generateVertical: !value.generateVertical })}
        />
        <ToggleSwitch
          label={t('genDialogueLabel')}
          hint={t('genDialogueHint')}
          checked={Boolean(value.dialogueMode)}
          onToggle={() => set({ dialogueMode: !value.dialogueMode })}
        />
        {value.dialogueMode && (
          <Select
            label={t('genDialogueVoiceLabel')}
            value={value.dialogueSecondVoice ?? ''}
            onChange={(e) => set({ dialogueSecondVoice: e.target.value || undefined })}
          >
            <option value="">{t('genDialogueVoiceDefault')}</option>
            {TTS_VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </Select>
        )}
      </fieldset>

      {/* Points de validation (P170) */}
      <fieldset className="flex flex-col gap-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">{t('genValidationLegend')}</legend>
        <ToggleSwitch
          label={t('genValAfterScriptsLabel')}
          hint={t('genValAfterScriptsHint')}
          checked={Boolean(value.validationPoints?.afterScripts)}
          onToggle={() =>
            set({
              validationPoints: {
                afterPlan: value.validationPoints?.afterPlan ?? true,
                afterDraft: value.validationPoints?.afterDraft ?? false,
                afterScripts: !value.validationPoints?.afterScripts,
              },
            })
          }
        />
        <ToggleSwitch
          label={t('genValAfterDraftLabel')}
          hint={t('genValAfterDraftHint')}
          checked={Boolean(value.validationPoints?.afterDraft)}
          onToggle={() =>
            set({
              validationPoints: {
                afterPlan: value.validationPoints?.afterPlan ?? true,
                afterScripts: value.validationPoints?.afterScripts ?? false,
                afterDraft: !value.validationPoints?.afterDraft,
              },
            })
          }
        />
      </fieldset>
    </div>
  );
}

/** Case à cocher maison (Radix absent) — bouton role=checkbox accessible. */
function PlatformCheckbox({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      className={cn(
        'flex w-full items-center gap-3 rounded-sm border px-3 py-2.5 text-sm',
        'transition-all duration-fast ease-standard',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80',
        'focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
        checked
          ? 'border-primary/60 bg-primary-soft text-foreground'
          : 'border-border bg-surface text-muted hover:border-ring/50 hover:text-foreground',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border',
          'transition-colors duration-fast ease-standard',
          checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-transparent',
        )}
      >
        {checked && <Check className="size-3" strokeWidth={3.5} />}
      </span>
      {label}
    </button>
  );
}

/** Interrupteur accessible maison (Radix absent) — bouton role=switch. */
function ToggleSwitch({
  label,
  hint,
  checked,
  onToggle,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-sm border border-border bg-surface px-3 py-2.5">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {hint && <span className="text-xs text-muted/80">{hint}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={onToggle}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full transition-colors duration-fast ease-standard',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80',
          'focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
          checked ? 'bg-primary' : 'bg-input',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-fast ease-standard',
            checked ? 'translate-x-[22px] rtl:-translate-x-[22px]' : 'translate-x-0.5 rtl:-translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}

/** Stepper du nombre de sections — boutons +/- clampés sur le schéma. */
function SectionsStepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const labelId = React.useId();
  const t = useTranslations('create.advanced');
  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="px-1 text-xs font-semibold text-muted">
        {t('sectionsLabel')}
      </span>
      <div
        role="group"
        aria-labelledby={labelId}
        className="flex items-center justify-between rounded-sm border border-input bg-surface px-2 py-1.5 shadow-sm"
      >
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={t('fewerSections')}
          disabled={value <= SECTIONS_MIN}
          onClick={() => onChange(Math.max(SECTIONS_MIN, value - 1))}
        >
          <Minus aria-hidden="true" />
        </Button>
        <span className="font-display text-xl font-semibold tabular-nums text-foreground" aria-live="polite">
          {value}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={t('moreSections')}
          disabled={value >= SECTIONS_MAX}
          onClick={() => onChange(Math.min(SECTIONS_MAX, value + 1))}
        >
          <Plus aria-hidden="true" />
        </Button>
      </div>
      <p className="px-1 text-xs text-muted/80">
        {t('sectionsRange', { min: SECTIONS_MIN, max: SECTIONS_MAX })}
      </p>
    </div>
  );
}

/**
 * Import de contenu existant (Prompt 90) — sélection d'un support source
 * (PDF/PPTX/Markdown) uploadé une fois le cours créé. Validation du type
 * client-side (miroir de detectSourceMaterialKind) pour un retour immédiat.
 */
function SourceMaterialField({
  file,
  onChange,
}: {
  file: File | null;
  onChange: (file: File | null) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [error, setError] = React.useState<string | null>(null);
  const t = useTranslations('create.advanced');

  const handlePick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0] ?? null;
    if (!picked) {
      onChange(null);
      setError(null);
      return;
    }
    if (!detectSourceMaterialKind(picked.name, picked.type)) {
      setError(t('sourceUnsupported'));
      onChange(null);
      return;
    }
    setError(null);
    onChange(picked);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="px-1 text-xs font-semibold text-muted">
        {t('sourceLabel')}
      </span>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.pptx,.md,.markdown,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/markdown"
        className="sr-only"
        onChange={handlePick}
      />
      {file ? (
        <div className="flex items-center justify-between gap-2 rounded-sm border border-primary/60 bg-primary-soft px-3 py-2.5 text-sm text-foreground">
          <span className="flex min-w-0 items-center gap-2">
            <FileText className="size-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="truncate">{file.name}</span>
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            aria-label={t('sourceRemove')}
            onClick={() => {
              onChange(null);
              if (inputRef.current) inputRef.current.value = '';
            }}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-sm border border-dashed border-input bg-surface px-3 py-2.5 text-sm text-muted',
            'transition-all duration-fast ease-standard hover:border-ring/50 hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80',
            'focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
          )}
        >
          <Upload className="size-4" aria-hidden="true" />
          {t('sourceChoose')}
        </button>
      )}
      {error && <p className="px-1 text-xs text-danger">{error}</p>}
      <p className="px-1 text-xs text-muted/80">
        {t('sourceHint')}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Panneau                                                             */
/* ------------------------------------------------------------------ */

export interface AdvancedOptionsPanelProps {
  value: AdvancedOptions;
  onChange: (value: AdvancedOptions) => void;
  /** Classes du bouton déclencheur (positionné par le parent). */
  triggerClassName?: string;
}

export function AdvancedOptionsPanel({ value, onChange, triggerClassName }: AdvancedOptionsPanelProps) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const titleId = React.useId();
  const t = useTranslations('create.advanced');

  // Échap ferme le panneau et restitue le focus au déclencheur.
  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const patch = (partial: Partial<AdvancedOptions>) => onChange({ ...value, ...partial });

  const togglePlatform = (id: string) =>
    patch({
      targetPlatforms: value.targetPlatforms.includes(id)
        ? value.targetPlatforms.filter((p) => p !== id)
        : [...value.targetPlatforms, id],
    });

  // Petit résumé porté par le déclencheur — rassure sans ouvrir le panneau.
  const localeLabel = COURSE_LOCALES.find((l) => l.value === value.locale)?.label ?? value.locale;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        className={cn(
          'group inline-flex items-center gap-2 rounded-full border border-transparent px-3.5 py-2 text-xs font-medium text-muted',
          'transition-all duration-fast ease-standard',
          'hover:border-border hover:bg-surface hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80',
          'focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          triggerClassName,
        )}
      >
        <SlidersHorizontal className="size-3.5 text-muted transition-colors group-hover:text-accent-400" aria-hidden="true" />
        {t('title')}
        <span className="hidden text-muted/60 sm:inline" aria-hidden="true">
          · {localeLabel} · {t('sectionsSuffix', { count: value.approxSections })}
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop discret — clic extérieur pour fermer */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 bg-neutral-950/60 backdrop-blur-sm"
              aria-hidden="true"
            />

            {/* Volet latéral côté inline-end */}
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              initial={{ opacity: 0, x: 48 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 48, transition: { duration: 0.18 } }}
              transition={transitions.springSoft}
              className={cn(
                'fixed inset-y-0 end-0 z-50 flex w-full max-w-sm flex-col gap-6 overflow-y-auto',
                'border-s border-border bg-surface p-6 shadow-xl',
              )}
            >
              <header className="flex items-start justify-between gap-4">
                <div>
                  <h2 id={titleId} className="font-display text-xl font-semibold text-foreground">
                    {t('title')}
                  </h2>
                  <p className="mt-1 text-xs text-muted">
                    {t('subtitle')}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('closeLabel')}
                  onClick={() => {
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                >
                  <X aria-hidden="true" />
                </Button>
              </header>

              <Select
                label={t('courseLanguageLabel')}
                value={value.locale}
                onChange={(event) => patch({ locale: event.target.value as Locale })}
              >
                {COURSE_LOCALES.map((locale) => (
                  <option key={locale.value} value={locale.value}>
                    {locale.label}
                  </option>
                ))}
              </Select>

              <ToggleSwitch
                label={t('customVoiceLabel')}
                hint={t('customVoiceHint')}
                checked={value.useCustomVoice}
                onToggle={() => patch({ useCustomVoice: !value.useCustomVoice })}
              />

              {/* Voix de narration du catalogue (fix « voix multiples ») : une
                  identité vocale UNIQUE épinglée sur tout le cours. Masqué si
                  la voix clonée de l'auteur est active (elle prime). Les voix
                  de la langue du cours sont listées en premier. */}
              {!value.useCustomVoice && (
                <Select
                  label={t('voiceCatalogLabel')}
                  hint={t('voiceCatalogHint', {
                    default: resolveCatalogVoice(undefined, value.locale).name,
                  })}
                  value={value.voiceId}
                  onChange={(event) => patch({ voiceId: event.target.value })}
                >
                  <option value="">{t('voiceCatalogDefault')}</option>
                  {[...VOICE_CATALOG]
                    .sort(
                      (a, b) =>
                        Number(b.locales.includes(value.locale)) - Number(a.locales.includes(value.locale)),
                    )
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} — {t(v.gender === 'female' ? 'voiceFemale' : 'voiceMale')} ({v.locales.join('/').toUpperCase()})
                      </option>
                    ))}
                </Select>
              )}

              <Select
                label={t('ttsEngineLabel')}
                hint={t('ttsEngineHint')}
                value={value.ttsEngine}
                onChange={(event) => patch({ ttsEngine: event.target.value as 'chatterbox' | 'qwen3' })}
              >
                <option value="chatterbox">{t('ttsEngineChatterbox')}</option>
                <option value="qwen3">{t('ttsEngineQwen3')}</option>
              </Select>

              <Select
                label={t('imageEngineLabel')}
                hint={t('imageEngineHint')}
                value={value.imageEngine}
                onChange={(event) => patch({ imageEngine: event.target.value as 'sdxl' | 'zimage' })}
              >
                <option value="sdxl">{t('imageEngineSdxl')}</option>
                <option value="zimage">{t('imageEngineZimage')}</option>
              </Select>

              {/* Thème visuel des slides et articles (catalogue 2026-07-26) —
                  modifiable après coup depuis la page du cours (re-rendu). */}
              <Select
                label={t('themeLabel')}
                hint={t('themeHint')}
                value={value.themeId}
                onChange={(event) => patch({ themeId: event.target.value })}
              >
                <option value="">{t('themeDefault')}</option>
                {THEME_CATALOG.filter((th) => th.id !== 'salistar').map((th) => (
                  <option key={th.id} value={th.id}>
                    {th.name}
                  </option>
                ))}
              </Select>

              <fieldset className="flex flex-col gap-1.5">
                <legend className="px-1 pb-1.5 text-xs font-semibold text-muted">
                  {t('platformsLegend')}
                </legend>
                <div className="grid grid-cols-2 gap-2">
                  {TARGET_PLATFORMS.map((platform) => (
                    <PlatformCheckbox
                      key={platform.id}
                      label={platform.label}
                      checked={value.targetPlatforms.includes(platform.id)}
                      onToggle={() => togglePlatform(platform.id)}
                    />
                  ))}
                </div>
                <p className="px-1 pt-0.5 text-xs text-muted/80">
                  {t('platformsHint')}
                </p>
              </fieldset>

              <div className="flex flex-col gap-2">
                <ToggleSwitch
                  label={t('avatarLabel')}
                  hint={t('avatarHint')}
                  checked={value.avatarEnabled}
                  onToggle={() => patch({ avatarEnabled: !value.avatarEnabled })}
                />
                {value.avatarEnabled && (
                  <Select
                    label={t('avatarSelectLabel')}
                    hint={t('avatarSelectHint')}
                    value={value.avatarId}
                    onChange={(event) => patch({ avatarId: event.target.value })}
                  >
                    {AVATAR_OPTIONS.map((avatar) => (
                      <option key={avatar.id} value={avatar.id}>
                        {avatar.label}
                      </option>
                    ))}
                  </Select>
                )}
              </div>

              <ToggleSwitch
                label={t('clonedVoiceLabel')}
                hint={t('clonedVoiceHint')}
                checked={value.useCustomVoice}
                onToggle={() => patch({ useCustomVoice: !value.useCustomVoice })}
              />

              <SourceMaterialField
                file={value.sourceMaterialFile}
                onChange={(sourceMaterialFile) => patch({ sourceMaterialFile })}
              />

              <ToggleSwitch
                label={t('offPeakLabel')}
                hint={t('offPeakHint', formatOffPeakSlot(new Date(), t('today'), t('tomorrow')))}
                checked={value.scheduleOffPeak}
                onToggle={() => patch({ scheduleOffPeak: !value.scheduleOffPeak })}
              />

              <SectionsStepper value={value.approxSections} onChange={(approxSections) => patch({ approxSections })} />

              {/* Paramètres de génération avancés (Phase 10) — structure/pédagogie/domaine */}
              <div className="border-t border-border pt-4">
                <GenerationParamsSection
                  value={value.advancedParams}
                  onChange={(advancedParams) => patch({ advancedParams })}
                />
              </div>

              <footer className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-4">
                <Button variant="ghost" size="sm" onClick={() => onChange(DEFAULT_ADVANCED_OPTIONS)}>
                  {t('reset')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                >
                  {t('done')}
                </Button>
              </footer>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
