/**
 * @sallycourse/design — tailwind.ts
 * Preset Tailwind SALISTAR dérivé des tokens. Consommé par
 * apps/web/tailwind.config.ts via `presets: [salistarPreset]`.
 * Aucune couleur en dur ici : tout provient de tokens.ts ou des CSS
 * variables sémantiques (--sc-*) injectées dans globals.css.
 *
 * NB : le paquet design ne dépend pas de `tailwindcss` ; le preset est
 * typé structurellement (compatible `Partial<Config>` côté apps/web).
 */

// Import par auto-référence du paquet ('@sallycourse/design/tokens' → src/tokens.ts) :
// un import relatif './tokens' serait résolu vers tokens.json par jiti (Tailwind CLI).
import {
  colors,
  durations,
  easings,
  fontFamilies,
  fontSizes,
  radii,
  shadows,
} from '@sallycourse/design/tokens';

/** Compose une couleur sémantique pilotée par CSS variable, opacité incluse. */
const semantic = (name: string): string => `rgb(var(--sc-${name}) / <alpha-value>)`;

/** Convertit l'échelle fontSizes des tokens vers le format Tailwind. */
const tailwindFontSize = Object.fromEntries(
  Object.entries(fontSizes).map(([key, value]) => [
    key,
    [value.size, { lineHeight: value.lineHeight, letterSpacing: value.letterSpacing }],
  ]),
) as Record<string, [string, { lineHeight: string; letterSpacing: string }]>;

/** Typage structurel minimal d'un preset Tailwind (theme.extend uniquement). */
export interface SalistarPreset {
  theme: { extend: Record<string, unknown> };
}

/** Preset SALISTAR — theme.extend complet dérivé des tokens. */
export const salistarPreset: SalistarPreset = {
  theme: {
    extend: {
      colors: {
        /* Échelles de marque (valeurs figées, indépendantes du thème) */
        neutral: colors.neutral,
        primary: {
          ...colors.violet,
          DEFAULT: semantic('primary'),
          foreground: semantic('primary-foreground'),
          soft: semantic('primary-soft'),
        },
        accent: {
          ...colors.gold,
          DEFAULT: semantic('accent'),
          foreground: semantic('accent-foreground'),
        },
        /* États sémantiques : échelle figée + DEFAULT thémé */
        success: {
          ...colors.success,
          DEFAULT: semantic('success'),
          foreground: semantic('status-foreground'),
        },
        warning: {
          ...colors.warning,
          DEFAULT: semantic('warning'),
          foreground: semantic('status-foreground'),
        },
        danger: {
          ...colors.danger,
          DEFAULT: semantic('danger'),
          foreground: semantic('status-foreground'),
        },
        info: {
          ...colors.info,
          DEFAULT: semantic('info'),
          foreground: semantic('status-foreground'),
        },
        /* Surfaces et textes pilotés par le thème (light/dark) */
        background: semantic('background'),
        surface: {
          DEFAULT: semantic('surface'),
          subtle: semantic('surface-subtle'),
        },
        foreground: semantic('foreground'),
        muted: semantic('muted-foreground'),
        border: semantic('border'),
        input: semantic('input'),
        ring: semantic('ring'),
      },

      fontFamily: {
        display: [...fontFamilies.display],
        sans: [...fontFamilies.sans],
        arabic: [...fontFamilies.arabic],
      },

      /* Échelle modulaire ratio 1.25 (voir tokens.fontSizes) */
      fontSize: tailwindFontSize,

      /* Rayons : md (12px) devient le rayon par défaut */
      borderRadius: {
        sm: radii.sm,
        DEFAULT: radii.md,
        md: radii.md,
        lg: radii.lg,
        xl: radii.xl,
        full: radii.full,
      },

      /* Ombres teintées violet — jamais de noir pur */
      boxShadow: {
        sm: shadows.sm,
        DEFAULT: shadows.md,
        md: shadows.md,
        lg: shadows.lg,
        xl: shadows.xl,
        glow: shadows.glow,
      },

      /* Compléments d'espacement sur grille 4px */
      spacing: {
        '4.5': '1.125rem', // 18px
        '13': '3.25rem', //  52px
        '15': '3.75rem', //  60px
        '18': '4.5rem', //   72px
        '22': '5.5rem', //   88px
      },

      transitionDuration: {
        instant: durations.instant,
        fast: durations.fast,
        DEFAULT: durations.base,
        base: durations.base,
        slow: durations.slow,
        slower: durations.slower,
      },

      transitionTimingFunction: {
        DEFAULT: easings.standard,
        standard: easings.standard,
        out: easings.out,
        in: easings.in,
        spring: easings.spring,
      },

      /* Animations d'entrée standard du produit */
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        'fade-in': `fade-in ${durations.base} ${easings.out} both`,
        'fade-in-up': `fade-in-up ${durations.slow} ${easings.out} both`,
        'scale-in': `scale-in ${durations.base} ${easings.spring} both`,
      },
    },
  },
};

export default salistarPreset;
