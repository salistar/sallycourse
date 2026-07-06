'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Minus, Plus, SlidersHorizontal, X } from 'lucide-react';
import type { Locale } from '@sallycourse/shared';
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
}

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

export const DEFAULT_ADVANCED_OPTIONS: AdvancedOptions = {
  locale: 'fr',
  ttsVoice: TTS_VOICES[0].id,
  targetPlatforms: ['udemy'],
  approxSections: 8,
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
