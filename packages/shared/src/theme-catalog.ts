// Catalogue de thèmes visuels des slides vidéo et des articles (2026-07-26).
//
// Chaque thème est un jeu de surcharges des variables CSS `:root` que TOUS les
// gabarits de slides consomment déjà (packages/design/render-templates/*.html :
// --bg, --surface, --fg, --violet-*, --gold-*, …). L'injection se fait par un
// <style>:root{…}</style> ajouté avant </head> au rendu (même mécanisme que le
// mode gros texte --text-scale) — AUCUN des gabarits HTML n'est modifié.
//
// Convention : les noms de variables restent « --violet-* » (échelle PRIMAIRE)
// et « --gold-* » (échelle ACCENT) quel que soit le thème — ce sont des noms
// d'emplacements, pas des couleurs. Un thème bleu surcharge --violet-500 avec
// du bleu.
//
// Le thème par défaut `salistar` reproduit EXACTEMENT les valeurs actuelles
// des gabarits : Course.themeId absent → aucun changement de rendu pour les
// cours existants.
//
// Côté web, les articles consomment les variables sémantiques du design
// system : le wrapper d'article applique `articleVars` (sous-ensemble) pour
// thémer l'affichage sans re-rendu.

export interface SlideTheme {
  /** Identifiant stable (Course.themeId) — ne jamais renommer. */
  id: string;
  /** Nom d'affichage (identique dans les 3 langues d'interface). */
  name: string;
  /** Aperçu UI : [fond, primaire, accent] (pastilles du sélecteur). */
  swatch: [string, string, string];
  /** Surcharges des variables des gabarits de slides. */
  vars: Record<string, string>;
}

/** Variables communes à tous les thèmes SOMBRES (neutres inchangés). */
const DARK_NEUTRALS = {
  '--bg': '#0D0714',
  '--surface': '#171021',
  '--surface-subtle': '#231B2F',
  '--fg': '#F3F0F7',
  '--muted': '#A89DBA',
  '--border': '#362D43',
};

export const THEME_CATALOG: SlideTheme[] = [
  {
    // Défaut historique — valeurs IDENTIQUES aux gabarits (tokens.ts dark).
    id: 'salistar',
    name: 'Salistar',
    swatch: ['#0D0714', '#8E55BE', '#D4A017'],
    vars: {
      ...DARK_NEUTRALS,
      '--violet-300': '#C8A9E4',
      '--violet-400': '#AB7DD3',
      '--violet-500': '#8E55BE',
      '--violet-700': '#5B2A86',
      '--violet-800': '#49226C',
      '--violet-900': '#381A53',
      '--violet-950': '#250F3A',
      '--gold-200': '#F1DC92',
      '--gold-300': '#E8C75C',
      '--gold-400': '#DEB232',
      '--gold-500': '#D4A017',
      '--gold-600': '#B28212',
    },
  },
  {
    // Bleu profond / cyan — tech, finance.
    id: 'ocean',
    name: 'Océan',
    swatch: ['#06121F', '#3B82C4', '#22B8B0'],
    vars: {
      '--bg': '#06121F',
      '--surface': '#0C1C2E',
      '--surface-subtle': '#12263B',
      '--fg': '#EEF4FA',
      '--muted': '#8FA8C0',
      '--border': '#1F3A54',
      '--violet-300': '#9CC4E8',
      '--violet-400': '#63A0D6',
      '--violet-500': '#3B82C4',
      '--violet-700': '#1F5588',
      '--violet-800': '#18446E',
      '--violet-900': '#123454',
      '--violet-950': '#0B2239',
      '--gold-200': '#A5EAE5',
      '--gold-300': '#63D4CC',
      '--gold-400': '#22B8B0',
      '--gold-500': '#149E96',
      '--gold-600': '#0E7F79',
    },
  },
  {
    // Vert émeraude / ambre — nature, ESG, santé.
    id: 'forest',
    name: 'Forêt',
    swatch: ['#07130C', '#2F9E5F', '#D9A62E'],
    vars: {
      '--bg': '#07130C',
      '--surface': '#0D1F14',
      '--surface-subtle': '#132A1B',
      '--fg': '#EFF7F1',
      '--muted': '#93B29D',
      '--border': '#23402D',
      '--violet-300': '#9AD8B4',
      '--violet-400': '#5FBD88',
      '--violet-500': '#2F9E5F',
      '--violet-700': '#1D6C40',
      '--violet-800': '#175733',
      '--violet-900': '#114327',
      '--violet-950': '#0A2C19',
      '--gold-200': '#F3DFA0',
      '--gold-300': '#E8C566',
      '--gold-400': '#D9A62E',
      '--gold-500': '#C08F1B',
      '--gold-600': '#9C7414',
    },
  },
  {
    // Prune chaude / corail — créatif, marketing, lifestyle.
    id: 'sunset',
    name: 'Crépuscule',
    swatch: ['#170A10', '#D4593C', '#E8B93F'],
    vars: {
      '--bg': '#170A10',
      '--surface': '#241118',
      '--surface-subtle': '#311822',
      '--fg': '#FAF1EE',
      '--muted': '#C09AA3',
      '--border': '#4A2733',
      '--violet-300': '#F0AC97',
      '--violet-400': '#E37F60',
      '--violet-500': '#D4593C',
      '--violet-700': '#983A24',
      '--violet-800': '#7B2E1D',
      '--violet-900': '#5E2316',
      '--violet-950': '#3E160E',
      '--gold-200': '#F8E5A6',
      '--gold-300': '#F0CF6B',
      '--gold-400': '#E8B93F',
      '--gold-500': '#D3A125',
      '--gold-600': '#AC821C',
    },
  },
  {
    // Gris graphite / argent bleuté — corporate sobre, juridique, compliance.
    id: 'graphite',
    name: 'Graphite',
    swatch: ['#0E1013', '#6B7A8F', '#9FB4C8'],
    vars: {
      '--bg': '#0E1013',
      '--surface': '#171A1F',
      '--surface-subtle': '#20242B',
      '--fg': '#F2F4F6',
      '--muted': '#9AA5B1',
      '--border': '#333A44',
      '--violet-300': '#B3C0CE',
      '--violet-400': '#8D9DAF',
      '--violet-500': '#6B7A8F',
      '--violet-700': '#485563',
      '--violet-800': '#3A4550',
      '--violet-900': '#2D353E',
      '--violet-950': '#1E242A',
      '--gold-200': '#D8E4EE',
      '--gold-300': '#BCCDDC',
      '--gold-400': '#9FB4C8',
      '--gold-500': '#8199B0',
      '--gold-600': '#65798D',
    },
  },
  {
    // Clair « papier » — violet/or sur fond ivoire ; académique, édition.
    id: 'ivoire',
    name: 'Ivoire',
    swatch: ['#FAF7F0', '#5B2A86', '#B28212'],
    vars: {
      '--bg': '#FAF7F0',
      '--surface': '#FFFFFF',
      '--surface-subtle': '#F1ECE1',
      '--fg': '#231B2F',
      '--muted': '#6E6480',
      '--border': '#D9D2C4',
      // Échelle primaire inversée : les emplacements « clairs » (300/400)
      // deviennent FONCÉS pour rester lisibles sur fond clair.
      '--violet-300': '#5B2A86',
      '--violet-400': '#6D3AA0',
      '--violet-500': '#8E55BE',
      '--violet-700': '#C8A9E4',
      '--violet-800': '#DECBF0',
      '--violet-900': '#EBDFF7',
      '--violet-950': '#F5EFFB',
      '--gold-200': '#8F6A0E',
      '--gold-300': '#B28212',
      '--gold-400': '#D4A017',
      '--gold-500': '#DEB232',
      '--gold-600': '#E8C75C',
    },
  },
];

export const THEME_CATALOG_IDS = THEME_CATALOG.map((t) => t.id) as [string, ...string[]];

export const DEFAULT_THEME_ID = 'salistar';

/** Thème par id — repli sur le défaut (tolérant aux données legacy). */
export function themeById(id: string | undefined | null): SlideTheme {
  return THEME_CATALOG.find((t) => t.id === id) ?? THEME_CATALOG[0]!;
}

/** `#RRGGBB` → canaux "R G B" (format des variables sémantiques --sc-*). */
function rgbChannels(hex: string): string {
  const clean = hex.replace('#', '');
  return `${parseInt(clean.slice(0, 2), 16)} ${parseInt(clean.slice(2, 4), 16)} ${parseInt(clean.slice(4, 6), 16)}`;
}

/**
 * Variables CSS pour l'affichage WEB des articles d'un cours thémé — surcharge
 * les variables sémantiques du design system (--sc-primary/--sc-accent, canaux
 * RGB consommés par Tailwind via `rgb(var(--sc-…) / α)`). Appliquées par un
 * wrapper `style={…}` autour de ArticleView : instantané, aucun re-rendu.
 */
export function articleVars(theme: SlideTheme): Record<string, string> {
  return {
    '--sc-primary': rgbChannels(theme.vars['--violet-500']!),
    '--sc-primary-soft': rgbChannels(theme.vars['--violet-300']!),
    '--sc-accent': rgbChannels(theme.vars['--gold-400']!),
  };
}
