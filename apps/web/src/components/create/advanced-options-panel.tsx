'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, FileText, Minus, Plus, SlidersHorizontal, Upload, X } from 'lucide-react';
import { computeNextOffPeakStart, detectSourceMaterialKind, type Locale } from '@sallycourse/shared';
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
  targetPlatforms: string[];
  approxSections: number;
  /** Avatar vidéo (P82, bêta) — segment « talking head » en intro/conclusion de section. */
  avatarEnabled: boolean;
  /** Avatar HeyGen choisi — ignoré si avatarEnabled=false. */
  avatarId: string;
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

/** Avatars HeyGen proposés — maquette locale, remplacée plus tard par l'API HeyGen. */
export const AVATAR_OPTIONS = [
  { id: 'heygen-avatar-clara', label: 'Clara — professionnelle' },
  { id: 'heygen-avatar-marc', label: 'Marc — décontracté' },
] as const;

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

/** Libellé court « demain 02:00 » / « aujourd'hui 02:00 » pour le hint du toggle (P134). */
function formatOffPeakHint(now: Date): string {
  const next = computeNextOffPeakStart(now);
  const hh = String(next.getHours()).padStart(2, '0');
  const mm = String(next.getMinutes()).padStart(2, '0');
  const sameDay = next.toDateString() === now.toDateString();
  return `${sameDay ? "aujourd'hui" : 'demain'} à ${hh}:${mm}`;
}

export const DEFAULT_ADVANCED_OPTIONS: AdvancedOptions = {
  locale: 'fr',
  ttsVoice: TTS_VOICES[0].id,
  targetPlatforms: ['udemy'],
  approxSections: 8,
  avatarEnabled: false,
  avatarId: AVATAR_OPTIONS[0].id,
  sourceMaterialFile: null,
  scheduleOffPeak: false,
};

/* ------------------------------------------------------------------ */
/* Sous-composants internes                                            */
/* ------------------------------------------------------------------ */

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
  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="px-1 text-xs font-semibold text-muted">
        Nombre de sections
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
          aria-label="Moins de sections"
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
          aria-label="Plus de sections"
          disabled={value >= SECTIONS_MAX}
          onClick={() => onChange(Math.min(SECTIONS_MAX, value + 1))}
        >
          <Plus aria-hidden="true" />
        </Button>
      </div>
      <p className="px-1 text-xs text-muted/80">
        Entre {SECTIONS_MIN} et {SECTIONS_MAX} — l’IA ajuste au sujet.
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

  const handlePick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0] ?? null;
    if (!picked) {
      onChange(null);
      setError(null);
      return;
    }
    if (!detectSourceMaterialKind(picked.name, picked.type)) {
      setError('Format non supporté — PDF, PPTX ou Markdown attendu.');
      onChange(null);
      return;
    }
    setError(null);
    onChange(picked);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="px-1 text-xs font-semibold text-muted">
        Importer un support existant (optionnel)
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
            aria-label="Retirer le support"
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
          Choisir un fichier PDF, PPTX ou Markdown
        </button>
      )}
      {error && <p className="px-1 text-xs text-danger">{error}</p>}
      <p className="px-1 text-xs text-muted/80">
        Le plan de cours s’appuiera sur ce contenu (progression, vocabulaire, exemples).
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
        Options avancées
        <span className="hidden text-muted/60 sm:inline" aria-hidden="true">
          · {localeLabel} · {value.approxSections} sections
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
                    Options avancées
                  </h2>
                  <p className="mt-1 text-xs text-muted">
                    Des valeurs par défaut soignées — n’ajustez que si besoin.
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Fermer les options avancées"
                  onClick={() => {
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                >
                  <X aria-hidden="true" />
                </Button>
              </header>

              <Select
                label="Langue du cours"
                value={value.locale}
                onChange={(event) => patch({ locale: event.target.value as Locale })}
              >
                {COURSE_LOCALES.map((locale) => (
                  <option key={locale.value} value={locale.value}>
                    {locale.label}
                  </option>
                ))}
              </Select>

              <Select
                label="Voix de narration (TTS)"
                hint="La voix lit chaque leçon vidéo."
                value={value.ttsVoice}
                onChange={(event) => patch({ ttsVoice: event.target.value })}
              >
                {TTS_VOICES.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.label}
                  </option>
                ))}
              </Select>

              <fieldset className="flex flex-col gap-1.5">
                <legend className="px-1 pb-1.5 text-xs font-semibold text-muted">
                  Plateformes cibles
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
                  Les exports (formats, miniatures) s’adaptent à chaque plateforme.
                </p>
              </fieldset>

              <div className="flex flex-col gap-2">
                <ToggleSwitch
                  label="Avatar vidéo (bêta)"
                  hint="Un avatar présente chaque section en intro et conclusion."
                  checked={value.avatarEnabled}
                  onToggle={() => patch({ avatarEnabled: !value.avatarEnabled })}
                />
                {value.avatarEnabled && (
                  <Select
                    label="Avatar"
                    hint="Rendu OSS (SadTalker) par défaut — qualité correcte mais plus rigide qu'un rendu premium (lip-sync moins précis, mouvements limités). Rendu HeyGen premium réservé aux plans payants, qualité nettement supérieure. Repli automatique en carte titre si indisponible."
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

              <SourceMaterialField
                file={value.sourceMaterialFile}
                onChange={(sourceMaterialFile) => patch({ sourceMaterialFile })}
              />

              <ToggleSwitch
                label="Programmer la génération cette nuit"
                hint={`Démarre en heures creuses (2h-6h) — prochain créneau ${formatOffPeakHint(new Date())}.`}
                checked={value.scheduleOffPeak}
                onToggle={() => patch({ scheduleOffPeak: !value.scheduleOffPeak })}
              />

              <SectionsStepper value={value.approxSections} onChange={(approxSections) => patch({ approxSections })} />

              <footer className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-4">
                <Button variant="ghost" size="sm" onClick={() => onChange(DEFAULT_ADVANCED_OPTIONS)}>
                  Réinitialiser
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                >
                  Terminé
                </Button>
              </footer>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
