/**
 * @sallycourse/design — marketing-assets.ts
 * Générateur déterministe de visuels marketing SVG pour les cours :
 *  - cover Udemy 750×422, miniature YouTube 1280×720 (max 4 mots affichés),
 *    image OG 1200×630, story 1080×1920.
 * Composition géométrique violette dont le motif varie par seed (hash du
 * titre) parmi 6 familles ; taille de texte équilibrée automatiquement
 * (fit + wrap 2 lignes max) ; contraste vérifié WCAG (ratio >= 4.5).
 * Sortie : chaîne SVG autonome, uniquement des couleurs issues des tokens.
 */

import { z } from 'zod';
// @ts-ignore TS1543 — JSON importé sans attribut `type: "json"` : requis seulement
// quand ce fichier est consommé en source par le worker (NodeNext) ; inoffensif ici (Bundler).
import tokens from './tokens.json';

/* ------------------------------------------------------------------ */
/* Palette locale (tokens uniquement — aucune couleur inventée)        */
/* ------------------------------------------------------------------ */

const violet = tokens.colors.violet;
const gold = tokens.colors.gold;
const neutral = tokens.colors.neutral;
const white = tokens.colors.white;

/* ------------------------------------------------------------------ */
/* Formats supportés                                                   */
/* ------------------------------------------------------------------ */

/** Dimensions des formats marketing (px). */
export const marketingFormats = {
  /** Image de cours Udemy. */
  udemy: { width: 750, height: 422 },
  /** Miniature YouTube — contraste fort, 4 mots max affichés. */
  youtube: { width: 1280, height: 720 },
  /** Open Graph (partage social). */
  og: { width: 1200, height: 630 },
  /** Story verticale (Instagram/TikTok). */
  story: { width: 1080, height: 1920 },
} as const;

export type MarketingFormat = keyof typeof marketingFormats;

/* ------------------------------------------------------------------ */
/* Spec zod                                                            */
/* ------------------------------------------------------------------ */

/** Spécification d'un visuel de cours (schéma strict). */
export const courseImageSpecSchema = z
  .object({
    /** Titre du cours — sert aussi de seed par défaut. */
    title: z.string().trim().min(1).max(200),
    /** Sous-titre / accroche optionnelle (masquée sur YouTube). */
    subtitle: z.string().trim().min(1).max(160).optional(),
    /** Format de sortie. */
    format: z.enum(['udemy', 'youtube', 'og', 'story']),
    /** Langue d'affichage (l'arabe bascule en RTL + police sans-serif). */
    lang: z.enum(['fr', 'en', 'ar']).default('fr'),
    /** Badge court (niveau, "Nouveau", …). */
    badge: z.string().trim().min(1).max(40).optional(),
    /** Seed explicite — remplace le titre pour la variation de motif. */
    seed: z.string().min(1).optional(),
  })
  .strict();

export type CourseImageSpecInput = z.input<typeof courseImageSpecSchema>;
export type CourseImageSpec = z.output<typeof courseImageSpecSchema>;

/* ------------------------------------------------------------------ */
/* Seed déterministe — hash FNV-1a + PRNG mulberry32                   */
/* ------------------------------------------------------------------ */

/** Hash FNV-1a 32 bits d'une chaîne (déterministe, rapide). */
export function hashSeed(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** PRNG mulberry32 — suite pseudo-aléatoire reproductible dans [0, 1). */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* Variation de motif                                                  */
/* ------------------------------------------------------------------ */

/** Les 6 familles de motifs géométriques. */
export const motifFamilies = [
  'vagues',
  'losanges',
  'cercles',
  'grille',
  'rayons',
  'terrasses',
] as const;

export type MotifFamily = (typeof motifFamilies)[number];

/** Variation déterministe dérivée du seed. */
export interface MotifVariation {
  family: MotifFamily;
  /** Rotation du groupe motif, en degrés. */
  rotation: number;
  /** Densité relative des éléments (0.25 → 1). */
  density: number;
  /** Miroir horizontal de la composition. */
  flip: boolean;
}

const ROTATIONS = [-14, -8, 0, 8, 14] as const;

/** Dérive la variation (famille, rotation, densité, miroir) d'un seed numérique. */
export function pickMotifVariation(seed: number): MotifVariation {
  const rng = createRng(seed);
  const familyIndex = Math.min(motifFamilies.length - 1, Math.floor(rng() * motifFamilies.length));
  const rotationIndex = Math.min(ROTATIONS.length - 1, Math.floor(rng() * ROTATIONS.length));
  return {
    family: motifFamilies[familyIndex] ?? 'vagues',
    rotation: ROTATIONS[rotationIndex] ?? 0,
    density: 0.25 + rng() * 0.75,
    flip: rng() < 0.5,
  };
}

/* ------------------------------------------------------------------ */
/* Contraste WCAG                                                      */
/* ------------------------------------------------------------------ */

function hexChannel(hex: string, offset: number): number {
  return parseInt(hex.slice(offset, offset + 2), 16) / 255;
}

function linearize(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

/** Luminance relative WCAG d'une couleur hex #RRGGBB. */
export function relativeLuminance(hex: string): number {
  const normalized = hex.replace('#', '');
  const r = linearize(hexChannel(normalized, 0));
  const g = linearize(hexChannel(normalized, 2));
  const b = linearize(hexChannel(normalized, 4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Ratio de contraste WCAG entre deux couleurs hex (1 → 21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Candidats d'ajustement, du plus clair au plus sombre (tokens uniquement). */
const CONTRAST_CANDIDATES = [
  white,
  neutral['50'],
  neutral['100'],
  gold['100'],
  neutral['300'],
  violet['950'],
  neutral['950'],
] as const;

/**
 * Retourne `preferred` si son contraste sur `background` atteint `minRatio`,
 * sinon le meilleur candidat de la palette qui l'atteint (ou, à défaut,
 * celui au ratio maximal). Garantit un texte lisible quel que soit le fond.
 */
export function ensureContrast(preferred: string, background: string, minRatio = 4.5): string {
  if (contrastRatio(preferred, background) >= minRatio) return preferred;
  let best: string = preferred;
  let bestRatio = contrastRatio(preferred, background);
  for (const candidate of CONTRAST_CANDIDATES) {
    const ratio = contrastRatio(candidate, background);
    if (ratio >= minRatio) return candidate;
    if (ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Estimation de largeur + fit du texte                                */
/* ------------------------------------------------------------------ */

const ARABIC_RANGE = /[؀-ۿݐ-ݿࢠ-ࣿ]/;

/** Facteur de largeur approximatif d'un caractère (fraction de la taille). */
function charWidthFactor(ch: string): number {
  if (ARABIC_RANGE.test(ch)) return 0.52;
  if (ch === ' ') return 0.28;
  if ("iIljt!.,:;|'’‘".includes(ch)) return 0.32;
  if ('frJ"()[]{}-–'.includes(ch)) return 0.42;
  if ('mwMW@%&'.includes(ch)) return 0.92;
  if (/[A-Z0-9À-ÖØ-Þ]/.test(ch)) return 0.68;
  return 0.54;
}

/**
 * Estimation de la largeur d'un texte (px) pour une taille de police donnée.
 * Heuristique par caractère — suffisante pour équilibrer une composition SVG.
 */
export function estimateTextWidth(text: string, fontSize: number, bold = false): number {
  let factor = 0;
  for (const ch of text) factor += charWidthFactor(ch);
  return factor * fontSize * (bold ? 1.06 : 1);
}

export interface FitTextOptions {
  /** Largeur maximale d'une ligne (px). */
  maxWidth: number;
  /** Taille de départ (px). */
  maxFontSize: number;
  /** Taille plancher (px). */
  minFontSize: number;
  /** Nombre de lignes maximum (défaut 2). */
  maxLines?: number;
  /** Palier de réduction (px) — défaut ≈ 6 % de la taille max. */
  step?: number;
  /** Graisse forte (élargit l'estimation). */
  bold?: boolean;
}

export interface FitTextResult {
  fontSize: number;
  lines: string[];
  /** true si le texte a dû être tronqué avec une ellipse. */
  truncated: boolean;
}

/** Wrap glouton par mots ; null si un mot seul dépasse la largeur. */
function wrapWords(text: string, fontSize: number, maxWidth: number, bold: boolean): string[] | null {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (estimateTextWidth(word, fontSize, bold) > maxWidth) return null;
    const candidate = current ? `${current} ${word}` : word;
    if (estimateTextWidth(candidate, fontSize, bold) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Wrap de secours : coupe les mots trop longs au caractère près. */
function hardWrap(text: string, fontSize: number, maxWidth: number, bold: boolean): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    for (const ch of word) {
      const candidate = current + ch;
      if (estimateTextWidth(candidate, fontSize, bold) <= maxWidth || current.length === 0) {
        current = candidate;
      } else {
        lines.push(current);
        current = ch;
      }
    }
    const withSpace = `${current} `;
    if (estimateTextWidth(withSpace, fontSize, bold) <= maxWidth) {
      current = withSpace;
    } else {
      lines.push(current.trimEnd());
      current = '';
    }
  }
  const rest = current.trimEnd();
  if (rest) lines.push(rest);
  return lines;
}

/**
 * Équilibrage automatique : réduit la taille par paliers jusqu'à ce que le
 * texte tienne en `maxLines` lignes, puis coupe avec ellipse en dernier
 * recours au plancher.
 */
export function fitText(text: string, options: FitTextOptions): FitTextResult {
  const maxLines = options.maxLines ?? 2;
  const bold = options.bold ?? false;
  const step = options.step ?? Math.max(1, Math.round(options.maxFontSize * 0.06));
  const cleaned = text.trim().replace(/\s+/g, ' ');
  if (!cleaned) return { fontSize: options.maxFontSize, lines: [], truncated: false };

  for (let size = options.maxFontSize; size >= options.minFontSize; size -= step) {
    const lines = wrapWords(cleaned, size, options.maxWidth, bold);
    if (lines && lines.length > 0 && lines.length <= maxLines) {
      return { fontSize: size, lines, truncated: false };
    }
  }

  // Plancher atteint : coupe dure + ellipse sur la dernière ligne.
  const size = options.minFontSize;
  let lines = hardWrap(cleaned, size, options.maxWidth, bold);
  let truncated = false;
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    let last = lines[maxLines - 1] ?? '';
    while (last.length > 1 && estimateTextWidth(`${last}…`, size, bold) > options.maxWidth) {
      last = last.slice(0, -1).trimEnd();
    }
    lines[maxLines - 1] = `${last}…`;
    truncated = true;
  }
  return { fontSize: size, lines, truncated };
}

/** Tronque un texte à `max` mots (sans ellipse — punchline miniature). */
export function limitWords(text: string, max: number): string {
  return text.trim().split(/\s+/).filter(Boolean).slice(0, max).join(' ');
}

/* ------------------------------------------------------------------ */
/* Utilitaires SVG                                                     */
/* ------------------------------------------------------------------ */

/**
 * Échappe un texte pour insertion sûre dans un attribut ou un nœud XML.
 * (non exporté : `escapeXml` est déjà exporté par annotations.ts — éviter
 * l'ambiguïté des `export *` du barrel index.ts)
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Formatte un nombre pour SVG (2 décimales max, sans zéros inutiles). */
function fx(n: number): string {
  return String(Number(n.toFixed(2)));
}

/* ------------------------------------------------------------------ */
/* Familles de motifs — rendu SVG déterministe                         */
/* ------------------------------------------------------------------ */

interface MotifContext {
  rng: () => number;
  width: number;
  height: number;
  density: number;
}

/** Nuances violettes utilisées par les motifs (du plus clair au plus sombre). */
const MOTIF_STROKES = [violet['400'], violet['500'], violet['600'], violet['700']] as const;

function motifStroke(rng: () => number): string {
  return MOTIF_STROKES[Math.min(MOTIF_STROKES.length - 1, Math.floor(rng() * MOTIF_STROKES.length))] ?? violet['500'];
}

/** Vagues — courbes de Bézier horizontales superposées. */
function renderVagues({ rng, width, height, density }: MotifContext): string {
  const count = 4 + Math.round(density * 7);
  const parts: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const y = (height * (i + 0.5)) / count + (rng() - 0.5) * height * 0.06;
    const amp = height * (0.04 + rng() * 0.09);
    const x1 = width * 0.25;
    const x2 = width * 0.75;
    const gold_ = rng() < 0.12;
    const path =
      `M ${fx(-width * 0.05)} ${fx(y)} ` +
      `C ${fx(x1)} ${fx(y - amp)}, ${fx(x1)} ${fx(y + amp)}, ${fx(width * 0.5)} ${fx(y)} ` +
      `S ${fx(x2)} ${fx(y - amp)}, ${fx(width * 1.05)} ${fx(y)}`;
    parts.push(
      `<path d="${path}" fill="none" stroke="${gold_ ? gold['400'] : motifStroke(rng)}" ` +
        `stroke-width="${fx(1.5 + rng() * 2.5)}" opacity="${fx(0.12 + rng() * 0.22)}"/>`,
    );
  }
  return parts.join('');
}

/** Losanges — trame de rhombes, quelques éclats or. */
function renderLosanges({ rng, width, height, density }: MotifContext): string {
  const cols = 5 + Math.round(density * 5);
  const cell = width / cols;
  const rows = Math.ceil(height / cell) + 1;
  const parts: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols + 1; col += 1) {
      if (rng() < 0.38) continue;
      const cx = col * cell + (row % 2 === 0 ? 0 : cell / 2);
      const cy = row * cell;
      const r = cell * (0.16 + rng() * 0.2);
      const gold_ = rng() < 0.08;
      const points = `${fx(cx)},${fx(cy - r)} ${fx(cx + r)},${fx(cy)} ${fx(cx)},${fx(cy + r)} ${fx(cx - r)},${fx(cy)}`;
      parts.push(
        gold_
          ? `<polygon points="${points}" fill="${gold['400']}" opacity="${fx(0.25 + rng() * 0.2)}"/>`
          : `<polygon points="${points}" fill="none" stroke="${motifStroke(rng)}" ` +
              `stroke-width="${fx(1 + rng() * 1.5)}" opacity="${fx(0.1 + rng() * 0.2)}"/>`,
      );
    }
  }
  return parts.join('');
}

/** Cercles concentriques — un à deux foyers d'anneaux. */
function renderCercles({ rng, width, height, density }: MotifContext): string {
  const focusCount = 1 + Math.round(rng());
  const parts: string[] = [];
  for (let f = 0; f < focusCount; f += 1) {
    const cx = width * (0.15 + rng() * 0.7);
    const cy = height * (0.15 + rng() * 0.7);
    const rings = 5 + Math.round(density * 9);
    const gap = Math.min(width, height) * (0.05 + rng() * 0.05);
    for (let k = 0; k < rings; k += 1) {
      const gold_ = rng() < 0.07;
      parts.push(
        `<circle cx="${fx(cx)}" cy="${fx(cy)}" r="${fx(gap * (k + 1))}" fill="none" ` +
          `stroke="${gold_ ? gold['400'] : motifStroke(rng)}" ` +
          `stroke-width="${fx(1.2 + rng() * 2)}" opacity="${fx(0.28 - k * (0.2 / rings))}"/>`,
      );
    }
  }
  return parts.join('');
}

/** Grille perspective — lignes convergeant vers un point de fuite. */
function renderGrille({ rng, width, height, density }: MotifContext): string {
  const vpx = width * (0.3 + rng() * 0.4);
  const vpy = height * (0.15 + rng() * 0.3);
  const parts: string[] = [];
  const rayCount = 8 + Math.round(density * 10);
  for (let i = 0; i <= rayCount; i += 1) {
    const bx = (width * 1.6 * i) / rayCount - width * 0.3;
    parts.push(
      `<line x1="${fx(vpx)}" y1="${fx(vpy)}" x2="${fx(bx)}" y2="${fx(height)}" ` +
        `stroke="${motifStroke(rng)}" stroke-width="1.5" opacity="${fx(0.1 + rng() * 0.15)}"/>`,
    );
  }
  const bandCount = 5 + Math.round(density * 6);
  for (let k = 1; k <= bandCount; k += 1) {
    // Espacement géométrique : les horizontales se resserrent vers le point de fuite.
    const t = Math.pow(k / bandCount, 1.8);
    const y = vpy + (height - vpy) * t;
    const gold_ = k === bandCount && rng() < 0.5;
    parts.push(
      `<line x1="0" y1="${fx(y)}" x2="${fx(width)}" y2="${fx(y)}" ` +
        `stroke="${gold_ ? gold['500'] : motifStroke(rng)}" stroke-width="${fx(1 + t * 2)}" ` +
        `opacity="${fx(0.08 + t * 0.2)}"/>`,
    );
  }
  return parts.join('');
}

/** Rayons — faisceaux triangulaires émanant d'un coin. */
function renderRayons({ rng, width, height, density }: MotifContext): string {
  const ox = rng() < 0.5 ? -width * 0.1 : width * 1.1;
  const oy = rng() < 0.5 ? -height * 0.1 : height * 1.1;
  const count = 9 + Math.round(density * 13);
  const reach = Math.hypot(width, height) * 1.4;
  const parts: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = rng() * Math.PI * 2;
    const spread = 0.012 + rng() * 0.03;
    const x1 = ox + Math.cos(angle - spread) * reach;
    const y1 = oy + Math.sin(angle - spread) * reach;
    const x2 = ox + Math.cos(angle + spread) * reach;
    const y2 = oy + Math.sin(angle + spread) * reach;
    const gold_ = rng() < 0.1;
    parts.push(
      `<polygon points="${fx(ox)},${fx(oy)} ${fx(x1)},${fx(y1)} ${fx(x2)},${fx(y2)}" ` +
        `fill="${gold_ ? gold['500'] : motifStroke(rng)}" opacity="${fx(0.06 + rng() * 0.12)}"/>`,
    );
  }
  return parts.join('');
}

/** Terrasses — strates en escalier empilées depuis le bas. */
function renderTerrasses({ rng, width, height, density }: MotifContext): string {
  const layers = 4 + Math.round(density * 4);
  const parts: string[] = [];
  const fills = [violet['900'], violet['800'], violet['700'], violet['600']] as const;
  for (let layer = 0; layer < layers; layer += 1) {
    const baseY = height * (1 - (layer + 1) * (0.75 / layers));
    const steps = 4 + Math.round(rng() * 4);
    const stepW = width / steps;
    let d = `M 0 ${fx(height)} L 0 ${fx(baseY + rng() * height * 0.05)}`;
    let y = baseY;
    for (let s = 0; s < steps; s += 1) {
      y = baseY + (rng() - 0.5) * height * 0.08;
      d += ` L ${fx(s * stepW)} ${fx(y)} L ${fx((s + 1) * stepW)} ${fx(y)}`;
    }
    d += ` L ${fx(width)} ${fx(height)} Z`;
    const fill = fills[Math.min(fills.length - 1, layer % fills.length)] ?? violet['800'];
    parts.push(`<path d="${d}" fill="${fill}" opacity="${fx(0.14 + layer * 0.05)}"/>`);
    if (rng() < 0.35) {
      // Liseré or discret sur le rebord d'une terrasse.
      parts.push(
        `<line x1="0" y1="${fx(y)}" x2="${fx(width)}" y2="${fx(y)}" ` +
          `stroke="${gold['500']}" stroke-width="1.5" opacity="0.25"/>`,
      );
    }
  }
  return parts.join('');
}

const MOTIF_RENDERERS: Record<MotifFamily, (ctx: MotifContext) => string> = {
  vagues: renderVagues,
  losanges: renderLosanges,
  cercles: renderCercles,
  grille: renderGrille,
  rayons: renderRayons,
  terrasses: renderTerrasses,
};

/* ------------------------------------------------------------------ */
/* Layout par format                                                   */
/* ------------------------------------------------------------------ */

interface LayoutConfig {
  pad: number;
  titleMax: number;
  titleMin: number;
  /** Fraction de la largeur allouée au bloc titre. */
  titleWidthRatio: number;
  subtitleSize: number;
  brandSize: number;
  badgeSize: number;
  /** Bloc titre centré horizontalement (sinon aligné au début). */
  centered: boolean;
  /** Position verticale du haut du bloc titre (fraction de la hauteur). */
  titleYRatio: number;
  uppercase: boolean;
  /** Nombre maximal de mots affichés (miniature YouTube : 4). */
  maxWords?: number;
  motifOpacity: number;
  showSubtitle: boolean;
}

const LAYOUTS: Record<MarketingFormat, LayoutConfig> = {
  udemy: {
    pad: 44,
    titleMax: 54,
    titleMin: 24,
    titleWidthRatio: 0.88,
    subtitleSize: 19,
    brandSize: 15,
    badgeSize: 13,
    centered: false,
    titleYRatio: 0.4,
    uppercase: false,
    motifOpacity: 0.5,
    showSubtitle: true,
  },
  youtube: {
    pad: 72,
    titleMax: 148,
    titleMin: 64,
    titleWidthRatio: 0.9,
    subtitleSize: 34,
    brandSize: 26,
    badgeSize: 22,
    centered: true,
    titleYRatio: 0.32,
    uppercase: true,
    maxWords: 4,
    motifOpacity: 0.55,
    showSubtitle: false,
  },
  og: {
    pad: 64,
    titleMax: 82,
    titleMin: 38,
    titleWidthRatio: 0.84,
    subtitleSize: 28,
    brandSize: 22,
    badgeSize: 17,
    centered: false,
    titleYRatio: 0.38,
    uppercase: false,
    motifOpacity: 0.5,
    showSubtitle: true,
  },
  story: {
    pad: 80,
    titleMax: 104,
    titleMin: 48,
    titleWidthRatio: 0.84,
    subtitleSize: 38,
    brandSize: 28,
    badgeSize: 24,
    centered: true,
    titleYRatio: 0.3,
    uppercase: false,
    motifOpacity: 0.55,
    showSubtitle: true,
  },
};

/** Pile de polices SVG selon la langue (AR : jamais de serif — règle maison). */
function fontStack(lang: CourseImageSpec['lang'], display: boolean): string {
  if (lang === 'ar') return "'IBM Plex Sans Arabic', Tahoma, Arial, sans-serif";
  return display
    ? "Fraunces, Georgia, 'Times New Roman', serif"
    : "Figtree, system-ui, 'Segoe UI', sans-serif";
}

/* ------------------------------------------------------------------ */
/* Générateur principal                                                */
/* ------------------------------------------------------------------ */

/**
 * Génère le SVG complet d'un visuel de cours.
 * Déterministe : une même spec produit toujours exactement la même chaîne.
 */
export function generateCourseImage(input: CourseImageSpecInput): string {
  const spec = courseImageSpecSchema.parse(input);
  const { width, height } = marketingFormats[spec.format];
  const layout = LAYOUTS[spec.format];
  const rtl = spec.lang === 'ar';

  const seedHash = hashSeed(spec.seed ?? spec.title);
  const variation = pickMotifVariation(seedHash);
  // Seed décorrélé pour le rendu interne du motif (constante de Weyl).
  const motifRng = createRng((seedHash ^ 0x9e3779b9) >>> 0);
  const idp = `sc${seedHash.toString(36)}`;

  /* --- Fond + contraste ------------------------------------------- */
  // Le texte repose sur le voile sombre : on vérifie le contraste contre
  // la plus claire des deux extrémités du dégradé de fond.
  const bgReference =
    relativeLuminance(violet['950']) > relativeLuminance(neutral['950'])
      ? violet['950']
      : neutral['950'];
  const titleColor = ensureContrast(neutral['50'], bgReference);
  const subtitleColor = ensureContrast(neutral['300'], bgReference);
  const brandColor = ensureContrast(gold['400'], bgReference);

  /* --- Texte : fit + wrap ------------------------------------------ */
  const rawTitle =
    layout.maxWords !== undefined ? limitWords(spec.title, layout.maxWords) : spec.title;
  const displayTitle = layout.uppercase && spec.lang !== 'ar' ? rawTitle.toUpperCase() : rawTitle;
  const maxTitleWidth = width * layout.titleWidthRatio - layout.pad * (layout.centered ? 0 : 1);
  const fit = fitText(displayTitle, {
    maxWidth: maxTitleWidth,
    maxFontSize: layout.titleMax,
    minFontSize: layout.titleMin,
    maxLines: 2,
    bold: true,
  });

  const anchor = layout.centered ? 'middle' : rtl ? 'end' : 'start';
  const textX = layout.centered ? width / 2 : rtl ? width - layout.pad : layout.pad;
  const lineHeight = fit.fontSize * 1.12;
  const titleTop = height * layout.titleYRatio;
  const direction = rtl ? ' direction="rtl"' : '';

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
      `viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(spec.title)}">`,
  );

  /* --- defs --------------------------------------------------------- */
  parts.push('<defs>');
  parts.push(
    `<linearGradient id="${idp}-bg" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="${violet['950']}"/>` +
      `<stop offset="0.55" stop-color="${violet['900']}"/>` +
      `<stop offset="1" stop-color="${neutral['950']}"/>` +
      '</linearGradient>',
  );
  parts.push(
    `<linearGradient id="${idp}-scrim" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="${neutral['950']}" stop-opacity="0.15"/>` +
      `<stop offset="0.45" stop-color="${neutral['950']}" stop-opacity="0.55"/>` +
      `<stop offset="1" stop-color="${neutral['950']}" stop-opacity="0.8"/>` +
      '</linearGradient>',
  );
  parts.push(
    `<linearGradient id="${idp}-bar" x1="0" y1="0" x2="1" y2="0">` +
      `<stop offset="0" stop-color="${gold['400']}"/>` +
      `<stop offset="1" stop-color="${gold['600']}"/>` +
      '</linearGradient>',
  );
  parts.push('</defs>');

  /* --- fond + motif + voile ---------------------------------------- */
  parts.push(`<rect width="${width}" height="${height}" fill="url(#${idp}-bg)"/>`);

  const motifSvg = MOTIF_RENDERERS[variation.family]({
    rng: motifRng,
    width,
    height,
    density: variation.density,
  });
  const flip = variation.flip ? ` scale(-1 1) translate(${fx(-width)} 0)` : '';
  parts.push(
    `<g opacity="${fx(layout.motifOpacity)}" ` +
      `transform="rotate(${variation.rotation} ${fx(width / 2)} ${fx(height / 2)})${flip}">` +
      motifSvg +
      '</g>',
  );
  parts.push(`<rect width="${width}" height="${height}" fill="url(#${idp}-scrim)"/>`);

  /* --- marque SALISTAR ---------------------------------------------- */
  const brandY = layout.pad + layout.brandSize;
  const brandX = layout.centered ? width / 2 : textX;
  parts.push(
    `<text x="${fx(brandX)}" y="${fx(brandY)}" text-anchor="${layout.centered ? 'middle' : anchor}" ` +
      `font-family="${fontStack(spec.lang, false)}" font-size="${layout.brandSize}" ` +
      `font-weight="600" letter-spacing="${fx(layout.brandSize * 0.28)}" ` +
      `fill="${brandColor}">SALISTAR</text>`,
  );

  /* --- badge (pill) -------------------------------------------------- */
  if (spec.badge) {
    const badgeText = spec.badge;
    const badgeFont = layout.badgeSize;
    const badgeW = estimateTextWidth(badgeText, badgeFont, false) + badgeFont * 1.6;
    const badgeH = badgeFont * 2;
    const badgeX = layout.centered
      ? (width - badgeW) / 2
      : rtl
        ? layout.pad
        : width - layout.pad - badgeW;
    const badgeY = layout.pad;
    const badgeColor = ensureContrast(gold['300'], bgReference);
    parts.push(
      `<rect x="${fx(badgeX)}" y="${fx(badgeY)}" width="${fx(badgeW)}" height="${fx(badgeH)}" ` +
        `rx="${fx(badgeH / 2)}" fill="none" stroke="${gold['500']}" stroke-width="1.5" opacity="0.9"/>`,
    );
    parts.push(
      `<text x="${fx(badgeX + badgeW / 2)}" y="${fx(badgeY + badgeH / 2 + badgeFont * 0.35)}" ` +
        `text-anchor="middle" font-family="${fontStack(spec.lang, false)}" ` +
        `font-size="${badgeFont}" font-weight="600" fill="${badgeColor}"${direction}>` +
        `${escapeXml(badgeText)}</text>`,
    );
  }

  /* --- titre ---------------------------------------------------------- */
  fit.lines.forEach((line, i) => {
    const y = titleTop + fit.fontSize * 0.9 + i * lineHeight;
    parts.push(
      `<text x="${fx(textX)}" y="${fx(y)}" text-anchor="${anchor}" ` +
        `font-family="${fontStack(spec.lang, true)}" font-size="${fit.fontSize}" ` +
        `font-weight="700" fill="${titleColor}"${direction}>${escapeXml(line)}</text>`,
    );
  });

  /* --- barre or sous le titre ------------------------------------------ */
  const barW = Math.min(width * 0.16, 180);
  const barH = Math.max(4, Math.round(fit.fontSize * 0.09));
  const barY = titleTop + fit.fontSize * 0.9 + (fit.lines.length - 1) * lineHeight + fit.fontSize * 0.55;
  const barX = layout.centered ? (width - barW) / 2 : rtl ? width - layout.pad - barW : layout.pad;
  parts.push(
    `<rect x="${fx(barX)}" y="${fx(barY)}" width="${fx(barW)}" height="${barH}" ` +
      `rx="${fx(barH / 2)}" fill="url(#${idp}-bar)"/>`,
  );

  /* --- sous-titre ------------------------------------------------------- */
  if (spec.subtitle && layout.showSubtitle) {
    const subFit = fitText(spec.subtitle, {
      maxWidth: maxTitleWidth,
      maxFontSize: layout.subtitleSize,
      minFontSize: Math.max(12, Math.round(layout.subtitleSize * 0.7)),
      maxLines: 2,
    });
    subFit.lines.forEach((line, i) => {
      const y = barY + barH + subFit.fontSize * 1.4 + i * subFit.fontSize * 1.35;
      parts.push(
        `<text x="${fx(textX)}" y="${fx(y)}" text-anchor="${anchor}" ` +
          `font-family="${fontStack(spec.lang, false)}" font-size="${subFit.fontSize}" ` +
          `font-weight="500" fill="${subtitleColor}"${direction}>${escapeXml(line)}</text>`,
      );
    });
  }

  parts.push('</svg>');
  return parts.join('');
}
