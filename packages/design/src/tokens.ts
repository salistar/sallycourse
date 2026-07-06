/**
 * @sallycourse/design — tokens.ts
 * Source de vérité UNIQUE du design system SALISTAR pour SallyCourse.
 * Toute couleur hexadécimale du monorepo vit ici (règle maison) ;
 * le reste du code consomme les classes Tailwind ou les CSS variables dérivées.
 */

/* ------------------------------------------------------------------ */
/* Couleurs — échelles 50→950                                          */
/* ------------------------------------------------------------------ */

/**
 * Violet SALISTAR — couleur primaire de marque (#5B2A86 posé au cran 700).
 * Usage : actions principales, liens, états actifs, identité.
 * 50–200 : fonds légers · 300–500 : interactifs sur fond sombre ·
 * 600–800 : interactifs sur fond clair · 900–950 : fonds profonds.
 */
export const violet = {
  50: '#F8F4FC',
  100: '#EFE6F8',
  200: '#DFCDF0',
  300: '#C8A9E4',
  400: '#AB7DD3',
  500: '#8E55BE',
  600: '#7239A2',
  700: '#5B2A86', // ← couleur de marque
  800: '#49226C',
  900: '#381A53',
  950: '#250F3A',
} as const;

/**
 * Or SALISTAR — accent premium (#D4A017 posé au cran 500).
 * Usage PARCIMONIEUX : badges, distinctions, moments de célébration,
 * soulignements décoratifs. Jamais en aplat massif.
 */
export const gold = {
  50: '#FCF7E6',
  100: '#F8EDC7',
  200: '#F1DC92',
  300: '#E8C75C',
  400: '#DEB232',
  500: '#D4A017', // ← accent de marque
  600: '#B28212',
  700: '#8E650F',
  800: '#6E4D10',
  900: '#573D11',
  950: '#332108',
} as const;

/**
 * Neutres CHAUDS teintés violet — aucune trace de gris froid.
 * Usage : textes, bordures, surfaces. 950 = fond sombre de marque #0D0714.
 */
export const neutral = {
  50: '#FAF8FC',
  100: '#F3F0F7',
  200: '#E7E2EE',
  300: '#D3CBDF',
  400: '#A89DBA',
  500: '#7F7492',
  600: '#61566F',
  700: '#4B4157',
  800: '#362D43',
  900: '#231B2F',
  950: '#0D0714', // ← fond sombre de marque
} as const;

/**
 * Succès — vert légèrement chaud, harmonisé avec la palette violette.
 * Usage : validations, quiz réussis, progression complétée.
 */
export const success = {
  50: '#EEFAF3',
  100: '#D6F3E3',
  200: '#ACE6C8',
  300: '#79D3A7',
  400: '#47BA84',
  500: '#2A9D68',
  600: '#1F7F53',
  700: '#1B6644',
  800: '#185138',
  900: '#14422E',
  950: '#09251A',
} as const;

/**
 * Avertissement — ambre chaud, cousin de l'or de marque sans le concurrencer.
 * Usage : états à surveiller, quotas, brouillons.
 */
export const warning = {
  50: '#FDF6EA',
  100: '#FAEACC',
  200: '#F5D391',
  300: '#EEB755',
  400: '#E69D2B',
  500: '#D98510',
  600: '#B5680C',
  700: '#8F4E0C',
  800: '#703D0F',
  900: '#5B3210',
  950: '#351B07',
} as const;

/**
 * Danger — rouge rosé chaud (pointe magenta pour rester dans la famille violette).
 * Usage : erreurs, suppressions, échecs de génération.
 */
export const danger = {
  50: '#FDF1F3',
  100: '#FBE0E5',
  200: '#F6C4CD',
  300: '#EE9AA9',
  400: '#E36A80',
  500: '#D4405C',
  600: '#B72B47',
  700: '#98203A',
  800: '#7C1D33',
  900: '#671C2E',
  950: '#390B16',
} as const;

/**
 * Info — bleu violacé (tiré vers l'indigo pour l'harmonie avec le primaire).
 * Usage : messages informatifs, astuces, états neutres de traitement.
 */
export const info = {
  50: '#F2F5FC',
  100: '#E2E9F9',
  200: '#C9D6F3',
  300: '#A3B8EA',
  400: '#7793DE',
  500: '#5670D1',
  600: '#4256C0',
  700: '#3A46A3',
  800: '#343C82',
  900: '#2E3567',
  950: '#1E2140',
} as const;

/** Regroupement des échelles brutes. */
export const colors = {
  violet,
  gold,
  neutral,
  success,
  warning,
  danger,
  info,
  /** Blanc pur — réservé aux surfaces claires et aux textes sur couleur pleine. */
  white: '#FFFFFF',
} as const;

/* ------------------------------------------------------------------ */
/* Thèmes sémantiques — valeurs résolues light / dark                  */
/* ------------------------------------------------------------------ */

/** Forme d'un thème sémantique (mêmes clés en light et en dark). */
export interface SemanticTheme {
  /** Fond global de page. */
  background: string;
  /** Surface de carte / panneau posée sur le fond. */
  surface: string;
  /** Surface secondaire discrète (bandeaux, zébrures, wells). */
  surfaceSubtle: string;
  /** Texte principal. */
  foreground: string;
  /** Texte secondaire / légendes. */
  mutedForeground: string;
  /** Bordures et séparateurs par défaut. */
  border: string;
  /** Bordures de champs de formulaire. */
  input: string;
  /** Couleur d'action primaire (boutons, liens). */
  primary: string;
  /** Texte posé sur `primary`. */
  primaryForeground: string;
  /** Fond léger teinté primaire (hover doux, pills, callouts). */
  primarySoft: string;
  /** Accent or — parcimonieux. */
  accent: string;
  /** Texte posé sur `accent`. */
  accentForeground: string;
  /** Anneau de focus clavier. */
  ring: string;
  /** États sémantiques résolus pour le thème (contraste garanti). */
  success: string;
  warning: string;
  danger: string;
  info: string;
  /** Texte posé sur les 4 couleurs d'état ci-dessus. */
  statusForeground: string;
}

/**
 * Thèmes résolus. Le dark est le thème PAR DÉFAUT de SallyCourse ;
 * le light reste disponible via la suppression de la classe `.dark`.
 * Ces valeurs alimentent le générateur de CSS variables (css-variables.ts).
 */
export const themes: { light: SemanticTheme; dark: SemanticTheme } = {
  light: {
    background: neutral[50],
    surface: colors.white,
    surfaceSubtle: neutral[100],
    foreground: neutral[950],
    mutedForeground: neutral[600],
    border: neutral[200],
    input: neutral[300],
    primary: violet[700],
    primaryForeground: neutral[50],
    primarySoft: violet[100],
    accent: gold[500],
    accentForeground: violet[950],
    ring: violet[500],
    success: success[600],
    warning: warning[600],
    danger: danger[600],
    info: info[600],
    statusForeground: colors.white,
  },
  dark: {
    background: neutral[950],
    surface: '#171021', // surface sombre intermédiaire entre neutral.950 et neutral.900
    surfaceSubtle: neutral[900],
    foreground: neutral[100],
    mutedForeground: neutral[400],
    border: neutral[800],
    input: neutral[700],
    primary: violet[500],
    primaryForeground: neutral[50],
    primarySoft: violet[950],
    accent: gold[400],
    accentForeground: violet[950],
    ring: violet[400],
    success: success[400],
    warning: warning[400],
    danger: danger[400],
    info: info[400],
    statusForeground: neutral[950],
  },
};

/* ------------------------------------------------------------------ */
/* Typographie                                                         */
/* ------------------------------------------------------------------ */

/**
 * Familles typographiques. Les variables CSS `--font-*` sont injectées
 * par next/font dans apps/web/src/app/layout.tsx.
 */
export const fontFamilies = {
  /** Titres et grands nombres — serif expressive. */
  display: ['var(--font-display)', 'Fraunces', 'Georgia', '"Times New Roman"', 'serif'],
  /** Corps de texte latin — sans humaniste. */
  sans: ['var(--font-sans)', 'Figtree', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
  /** Texte arabe — titres ET corps (Fraunces ne couvre pas l'arabe). */
  arabic: ['var(--font-arabic)', '"IBM Plex Sans Arabic"', 'Tahoma', 'Arial', 'sans-serif'],
} as const;

/**
 * Règles d'appariement FR ↔ AR :
 * - FR/EN : titres en `display` (Fraunces), corps en `sans` (Figtree).
 * - AR (dir="rtl") : titres ET corps en `arabic` (IBM Plex Sans Arabic) —
 *   graisse ≥ 600 pour les titres afin de compenser l'absence de serif arabe.
 * - Texte mixte : la famille suit la langue DOMINANTE du bloc ; les fallbacks
 *   couvrent les insertions ponctuelles de l'autre écriture.
 * - Ne jamais italiser l'arabe ; préférer graisse ou couleur pour l'emphase.
 */
export const fontPairing = {
  latin: { heading: 'display', body: 'sans' },
  arabic: { heading: 'arabic', body: 'arabic', headingWeightMin: 600 },
} as const;

/**
 * Échelle typographique MODULAIRE — ratio 1.25 (quarte majeure), base 1rem.
 * Interlignage resserré à mesure que la taille croît ; léger tracking
 * négatif sur les grands corps pour l'élégance du serif.
 */
export const fontSizes = {
  /** 10.24px — mentions légales, exposants. */
  '2xs': { size: '0.64rem', lineHeight: '1.6', letterSpacing: '0.02em' },
  /** 12.8px — légendes, métadonnées. */
  xs: { size: '0.8rem', lineHeight: '1.6', letterSpacing: '0.01em' },
  /** 14px (hors échelle, assumé) — UI dense : boutons, labels. */
  sm: { size: '0.875rem', lineHeight: '1.55', letterSpacing: '0' },
  /** 16px — corps de texte de référence. */
  base: { size: '1rem', lineHeight: '1.6', letterSpacing: '0' },
  /** 20px — lead, sous-titres. */
  lg: { size: '1.25rem', lineHeight: '1.5', letterSpacing: '0' },
  /** 25px — H4. */
  xl: { size: '1.563rem', lineHeight: '1.4', letterSpacing: '-0.005em' },
  /** 31.25px — H3. */
  '2xl': { size: '1.953rem', lineHeight: '1.3', letterSpacing: '-0.01em' },
  /** 39px — H2. */
  '3xl': { size: '2.441rem', lineHeight: '1.2', letterSpacing: '-0.015em' },
  /** 48.8px — H1. */
  '4xl': { size: '3.052rem', lineHeight: '1.1', letterSpacing: '-0.02em' },
  /** 61px — hero. */
  '5xl': { size: '3.815rem', lineHeight: '1.05', letterSpacing: '-0.02em' },
  /** 76.3px — affichage exceptionnel (landing). */
  '6xl': { size: '4.768rem', lineHeight: '1', letterSpacing: '-0.025em' },
} as const;

/** Graisses standardisées (couvertes par Figtree et IBM Plex Sans Arabic). */
export const fontWeights = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

/* ------------------------------------------------------------------ */
/* Espacements — grille 4px stricte                                    */
/* ------------------------------------------------------------------ */

/**
 * Échelle d'espacement sur grille 4px (clé = multiple de 4px, convention
 * Tailwind). Seule exception sub-4px : 0.5 (2px) pour les micro-ajustements.
 */
export const spacing = {
  0: '0px',
  0.5: '0.125rem', // 2px — micro-ajustement
  1: '0.25rem', //   4px
  1.5: '0.375rem', // 6px — icône/texte serrés
  2: '0.5rem', //    8px
  3: '0.75rem', //  12px
  4: '1rem', //     16px — pas de base des composants
  5: '1.25rem', //  20px
  6: '1.5rem', //   24px — padding de carte
  8: '2rem', //     32px
  10: '2.5rem', //  40px
  12: '3rem', //    48px — respiration de section
  16: '4rem', //    64px
  20: '5rem', //    80px
  24: '6rem', //    96px — grands blocs de landing
  32: '8rem', //   128px
} as const;

/* ------------------------------------------------------------------ */
/* Rayons                                                              */
/* ------------------------------------------------------------------ */

/**
 * Rayons de bordure. Trois crans structurants : 8 (contrôles), 12 (cartes),
 * 16 (panneaux/modales) + xl pour les héros et full pour les pills.
 */
export const radii = {
  sm: '0.5rem', //   8px — boutons, inputs, badges rectangulaires
  md: '0.75rem', // 12px — cartes, dropdowns (rayon PAR DÉFAUT)
  lg: '1rem', //    16px — modales, panneaux, grandes cartes
  xl: '1.5rem', //  24px — blocs hero, illustrations
  full: '9999px', // pills, avatars
} as const;

/* ------------------------------------------------------------------ */
/* Ombres — TOUJOURS teintées violet, jamais de noir pur               */
/* ------------------------------------------------------------------ */

/**
 * Ombres subtiles teintées violet profond (base rgb(37 15 58) = violet.950).
 * `glow` : halo violet réservé aux éléments premium (CTA, carte mise en avant).
 */
export const shadows = {
  sm: '0 1px 2px 0 rgb(37 15 58 / 0.08)',
  md: '0 2px 8px -2px rgb(37 15 58 / 0.12), 0 1px 2px 0 rgb(37 15 58 / 0.06)',
  lg: '0 8px 24px -6px rgb(37 15 58 / 0.16), 0 2px 6px -2px rgb(37 15 58 / 0.08)',
  xl: '0 16px 48px -12px rgb(37 15 58 / 0.22)',
  glow: '0 0 0 1px rgb(142 85 190 / 0.25), 0 4px 24px -4px rgb(142 85 190 / 0.35)',
} as const;

/* ------------------------------------------------------------------ */
/* Animation — durées et courbes standardisées                         */
/* ------------------------------------------------------------------ */

/** Durées standard. Micro-interactions courtes, transitions de vue plus longues. */
export const durations = {
  instant: '100ms', // feedback immédiat (pressed)
  fast: '150ms', //   hover, focus
  base: '250ms', //   transitions par défaut
  slow: '400ms', //   entrées/sorties de panneaux
  slower: '600ms', // séquences orchestrées (staggers)
} as const;

/** Courbes d'animation standardisées. */
export const easings = {
  /** Courbe par défaut, symétrique. */
  standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
  /** Entrées d'éléments (décélération). */
  out: 'cubic-bezier(0, 0, 0.2, 1)',
  /** Sorties d'éléments (accélération). */
  in: 'cubic-bezier(0.4, 0, 1, 1)',
  /** Rebond doux — célébrations, badges (à petite dose). */
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
} as const;

/* ------------------------------------------------------------------ */
/* Agrégats                                                            */
/* ------------------------------------------------------------------ */

/** Objet racine — l'intégralité des tokens du design system. */
export const tokens = {
  colors,
  themes,
  typography: { fontFamilies, fontPairing, fontSizes, fontWeights },
  spacing,
  radii,
  shadows,
  motion: { durations, easings },
} as const;

export type Tokens = typeof tokens;

/** Raccourci de marque (rétro-compatibilité avec le placeholder initial). */
export const BRAND = {
  primary: violet[700],
  accent: gold[500],
} as const;
