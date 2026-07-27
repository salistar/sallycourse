'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
// Sous-module direct (pas le baril) : évite d'embarquer render-templates.ts
// (Node-only, node:url) dans le bundle navigateur d'un composant client.
import { colors } from '@sallycourse/design/tokens';
import { cn } from '@/lib/cn';
import { PreviewFrame } from './preview-frame';
import { ExampleLabel, StyleSection } from './section-shell';

/**
 * Section palette : les échelles 50→950 rendues depuis les tokens
 * (@sallycourse/design), plus les rôles sémantiques qui réagissent en
 * direct à la bascule light/dark. Les classes Tailwind sont écrites en
 * clair (jamais composées dynamiquement — contrainte du purge Tailwind).
 */

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
type Shade = (typeof SHADES)[number];

interface ColorFamily {
  labelKey: string;
  usageKey: string;
  hex: Record<Shade, string>;
  /** Classes bg-* épelées une à une pour chaque cran. */
  swatch: Record<Shade, string>;
  /** Cran de marque à mettre en avant (anneau doré). */
  brandShade?: Shade;
}

const FAMILIES: ColorFamily[] = [
  {
    labelKey: 'families.violet.label',
    usageKey: 'families.violet.usage',
    hex: colors.violet,
    brandShade: 700,
    swatch: {
      50: 'bg-primary-50', 100: 'bg-primary-100', 200: 'bg-primary-200', 300: 'bg-primary-300',
      400: 'bg-primary-400', 500: 'bg-primary-500', 600: 'bg-primary-600', 700: 'bg-primary-700',
      800: 'bg-primary-800', 900: 'bg-primary-900', 950: 'bg-primary-950',
    },
  },
  {
    labelKey: 'families.gold.label',
    usageKey: 'families.gold.usage',
    hex: colors.gold,
    brandShade: 500,
    swatch: {
      50: 'bg-accent-50', 100: 'bg-accent-100', 200: 'bg-accent-200', 300: 'bg-accent-300',
      400: 'bg-accent-400', 500: 'bg-accent-500', 600: 'bg-accent-600', 700: 'bg-accent-700',
      800: 'bg-accent-800', 900: 'bg-accent-900', 950: 'bg-accent-950',
    },
  },
  {
    labelKey: 'families.neutral.label',
    usageKey: 'families.neutral.usage',
    hex: colors.neutral,
    brandShade: 950,
    swatch: {
      50: 'bg-neutral-50', 100: 'bg-neutral-100', 200: 'bg-neutral-200', 300: 'bg-neutral-300',
      400: 'bg-neutral-400', 500: 'bg-neutral-500', 600: 'bg-neutral-600', 700: 'bg-neutral-700',
      800: 'bg-neutral-800', 900: 'bg-neutral-900', 950: 'bg-neutral-950',
    },
  },
  {
    labelKey: 'families.success.label',
    usageKey: 'families.success.usage',
    hex: colors.success,
    swatch: {
      50: 'bg-success-50', 100: 'bg-success-100', 200: 'bg-success-200', 300: 'bg-success-300',
      400: 'bg-success-400', 500: 'bg-success-500', 600: 'bg-success-600', 700: 'bg-success-700',
      800: 'bg-success-800', 900: 'bg-success-900', 950: 'bg-success-950',
    },
  },
  {
    labelKey: 'families.warning.label',
    usageKey: 'families.warning.usage',
    hex: colors.warning,
    swatch: {
      50: 'bg-warning-50', 100: 'bg-warning-100', 200: 'bg-warning-200', 300: 'bg-warning-300',
      400: 'bg-warning-400', 500: 'bg-warning-500', 600: 'bg-warning-600', 700: 'bg-warning-700',
      800: 'bg-warning-800', 900: 'bg-warning-900', 950: 'bg-warning-950',
    },
  },
  {
    labelKey: 'families.danger.label',
    usageKey: 'families.danger.usage',
    hex: colors.danger,
    swatch: {
      50: 'bg-danger-50', 100: 'bg-danger-100', 200: 'bg-danger-200', 300: 'bg-danger-300',
      400: 'bg-danger-400', 500: 'bg-danger-500', 600: 'bg-danger-600', 700: 'bg-danger-700',
      800: 'bg-danger-800', 900: 'bg-danger-900', 950: 'bg-danger-950',
    },
  },
  {
    labelKey: 'families.info.label',
    usageKey: 'families.info.usage',
    hex: colors.info,
    swatch: {
      50: 'bg-info-50', 100: 'bg-info-100', 200: 'bg-info-200', 300: 'bg-info-300',
      400: 'bg-info-400', 500: 'bg-info-500', 600: 'bg-info-600', 700: 'bg-info-700',
      800: 'bg-info-800', 900: 'bg-info-900', 950: 'bg-info-950',
    },
  },
];

/** Pastille cliquable : copie le hex du token dans le presse-papiers. */
function Swatch({
  shade,
  hex,
  swatchClass,
  brand,
}: {
  shade: Shade;
  hex: string;
  swatchClass: string;
  brand: boolean;
}) {
  const t = useTranslations('design.palette');
  const [copied, setCopied] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(hex);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1400);
    } catch {
      // Presse-papiers indisponible (permissions) : on ignore silencieusement.
    }
  };

  // Texte lisible quel que soit le cran : sombre sur 50-400, clair sur 500-950.
  const onLight = shade <= 400;

  return (
    <button
      type="button"
      onClick={copy}
      title={t('swatch.copyTitle', { hex })}
      className={cn(
        'group flex h-16 min-w-0 flex-col justify-between rounded-md p-1.5 text-start',
        'transition-transform duration-fast ease-out hover:-translate-y-0.5',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
        brand && 'ring-1 ring-accent-400/70 ring-offset-1 ring-offset-surface',
        swatchClass,
      )}
    >
      <span className={cn('text-2xs font-bold', onLight ? 'text-neutral-950/70' : 'text-neutral-50/90')}>
        {shade}
      </span>
      <span
        className={cn(
          'truncate text-2xs font-medium tracking-tight',
          onLight ? 'text-neutral-950/60' : 'text-neutral-50/70',
        )}
      >
        {copied ? t('swatch.copied') : hex}
      </span>
    </button>
  );
}

/** Rôles sémantiques pilotés par CSS variables — réagissent au thème en direct. */
function SemanticRoles() {
  const t = useTranslations('design.palette');
  return (
    <div className="flex flex-col gap-3">
      <ExampleLabel>{t('roles.heading')}</ExampleLabel>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <RoleChip className="bg-background text-foreground" name="background" note={t('roles.background.note')} bordered />
        <RoleChip className="bg-surface text-foreground" name="surface" note={t('roles.surface.note')} bordered />
        <RoleChip className="bg-surface-subtle text-foreground" name="surface-subtle" note={t('roles.surfaceSubtle.note')} bordered />
        <RoleChip className="bg-primary text-primary-foreground" name="primary" note={t('roles.primary.note')} />
        <RoleChip className="bg-primary-soft text-foreground" name="primary-soft" note={t('roles.primarySoft.note')} bordered />
        <RoleChip className="bg-accent text-accent-foreground" name="accent" note={t('roles.accent.note')} />
        <RoleChip className="bg-success text-success-foreground" name="success" note={t('roles.success.note')} />
        <RoleChip className="bg-warning text-warning-foreground" name="warning" note={t('roles.warning.note')} />
        <RoleChip className="bg-danger text-danger-foreground" name="danger" note={t('roles.danger.note')} />
        <RoleChip className="bg-info text-info-foreground" name="info" note={t('roles.info.note')} />
        <RoleChip className="bg-surface text-muted" name="muted" note={t('roles.muted.note')} bordered />
        <RoleChip className="bg-surface text-foreground ring-2 ring-ring ring-offset-2 ring-offset-background" name="ring" note={t('roles.ring.note')} bordered />
      </div>
    </div>
  );
}

function RoleChip({
  className,
  name,
  note,
  bordered,
}: {
  className: string;
  name: string;
  note: string;
  bordered?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex h-20 flex-col justify-between rounded-md p-3 transition-colors duration-base',
        bordered && 'border border-border',
        className,
      )}
    >
      <span className="text-xs font-bold">{name}</span>
      <span className="text-2xs opacity-80">{note}</span>
    </div>
  );
}

export function PaletteSection() {
  const t = useTranslations('design.palette');
  return (
    <StyleSection
      id="palette"
      index={1}
      title={t('title')}
      lead={t('lead')}
    >
      <PreviewFrame>
        <div className="flex flex-col gap-8">
          {FAMILIES.map((family) => (
            <div key={family.labelKey} className="flex flex-col gap-2.5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="text-sm font-semibold text-foreground">{t(family.labelKey)}</h3>
                <p className="text-xs text-muted">{t(family.usageKey)}</p>
              </div>
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-11">
                {SHADES.map((shade) => (
                  <Swatch
                    key={shade}
                    shade={shade}
                    hex={family.hex[shade]}
                    swatchClass={family.swatch[shade]}
                    brand={family.brandShade === shade}
                  />
                ))}
              </div>
            </div>
          ))}
          <SemanticRoles />
        </div>
      </PreviewFrame>
    </StyleSection>
  );
}
