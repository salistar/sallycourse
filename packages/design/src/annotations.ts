/**
 * @sallycourse/design — annotations.ts
 * Bibliothèque d'annotation SVG pour le rendu ÉDITORIAL des captures d'écran
 * des TP. Fonctions PURES : elles ne touchent ni au DOM ni au disque, elles
 * produisent des chaînes SVG que le worker compose avec sharp.
 *
 * Contrat de composition côté worker (sharp) :
 *   1. base : canvas transparent de canvasWidth × canvasHeight ;
 *   2. composite dans CET ordre :
 *      a. la capture brute à (imagePlacement.left, imagePlacement.top) ;
 *      b. si zoomInsetPlacement : l'extrait `extract` agrandi à `size`,
 *         masqué en cercle via zoomInsetMaskSvg(size), posé à `composite` ;
 *      c. Buffer.from(overlaySvg) à (0, 0).
 *   L'overlay est plein cadre : il peint le fond subtil AUTOUR de la capture
 *   (fenêtre arrondie évidée par masque de luminance), l'ombre portée douce,
 *   puis les annotations et la légende PAR-DESSUS la capture.
 *
 * Toutes les couleurs et polices proviennent de tokens.json (source miroir
 * de tokens.ts) — aucune couleur hexadécimale n'est définie ici.
 */

import { z } from 'zod';
// @ts-ignore TS1543 — JSON importé sans attribut `type: "json"` : requis seulement
// quand ce fichier est consommé en source par le worker (NodeNext) ; inoffensif ici (Bundler).
import tokens from './tokens.json';

/* ------------------------------------------------------------------ */
/* Utilitaires internes                                                */
/* ------------------------------------------------------------------ */

/** Convertit une longueur token ('0.875rem', '4px', '0px') en pixels. */
function remToPx(value: string): number {
  const parsed = Number.parseFloat(value);
  return value.trim().endsWith('rem') ? parsed * 16 : parsed;
}

/** Arrondi à 2 décimales pour des attributs SVG compacts et stables. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Formatte un nombre pour un attribut SVG. */
function fmt(n: number): string {
  return String(round2(n));
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

/** Échappe une chaîne pour insertion sûre dans du contenu/attribut XML. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Pile de polices SVG dérivée des tokens : retire les `var(--font-*)`
 * (inconnues de librsvg) et normalise les guillemets pour l'attribut.
 */
export function svgFontFamily(kind: 'display' | 'sans' | 'arabic'): string {
  return tokens.typography.fontFamilies[kind]
    .filter((family) => !family.startsWith('var('))
    .map((family) => family.replace(/"/g, "'"))
    .join(', ');
}

/* ------------------------------------------------------------------ */
/* Parsing des ombres CSS des tokens                                   */
/* ------------------------------------------------------------------ */

/** Une couche d'ombre CSS décomposée (valeurs en px). */
export interface ShadowLayer {
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  color: { r: number; g: number; b: number; alpha: number };
}

/**
 * Parse une ombre CSS token, ex. `0 16px 48px -12px rgb(37 15 58 / 0.22)`
 * (une ou plusieurs couches séparées par des virgules hors parenthèses).
 */
export function parseCssShadow(shadow: string): ShadowLayer[] {
  return shadow.split(/,(?![^()]*\))/).map((rawLayer) => {
    const layer = rawLayer.trim();
    const colorMatch = layer.match(/rgb\((\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\)/);
    if (!colorMatch) {
      throw new Error(`Ombre token illisible (couleur absente) : "${layer}"`);
    }
    const prefix = layer.slice(0, colorMatch.index);
    const lengths = (prefix.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const [offsetX = 0, offsetY = 0, blur = 0, spread = 0] = lengths;
    return {
      offsetX,
      offsetY,
      blur,
      spread,
      color: {
        r: Number(colorMatch[1]),
        g: Number(colorMatch[2]),
        b: Number(colorMatch[3]),
        alpha: Number(colorMatch[4]),
      },
    };
  });
}

/* ------------------------------------------------------------------ */
/* Schémas zod — AnnotationSpec                                        */
/* ------------------------------------------------------------------ */

/** Coordonnée exprimée dans le repère de la CAPTURE (pixels, origine haut-gauche). */
const pointSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
  })
  .strict();

/**
 * Flèche COURBE (Bézier quadratique) — jamais de flèche droite « Paint ».
 * `curvature` : bombé perpendiculaire signé (-1 … 1), 0 = quasi droite.
 */
export const arrowSchema = z
  .object({
    from: pointSchema,
    to: pointSchema,
    curvature: z.number().min(-1).max(1).default(0.35),
    color: z.enum(['primary', 'accent', 'foreground']).default('primary'),
  })
  .strict()
  .refine(
    (a) => Math.hypot(a.to.x - a.from.x, a.to.y - a.from.y) >= 8,
    { message: 'Flèche trop courte : from et to doivent être distants d’au moins 8px.' },
  );

/** Pastille numérotée violette. `number` omis → numérotation par ordre du tableau. */
export const badgeSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    number: z.number().int().min(1).max(99).optional(),
  })
  .strict();

/** Surbrillance or translucide d'une zone — rectangle arrondi ou ellipse. */
export const highlightSchema = z.discriminatedUnion('shape', [
  z
    .object({
      shape: z.literal('rect'),
      x: z.number().finite(),
      y: z.number().finite(),
      width: z.number().positive().finite(),
      height: z.number().positive().finite(),
    })
    .strict(),
  z
    .object({
      shape: z.literal('ellipse'),
      cx: z.number().finite(),
      cy: z.number().finite(),
      rx: z.number().positive().finite(),
      ry: z.number().positive().finite(),
    })
    .strict(),
]);

/** Légende typographiée sous la capture. `label` : sur-titre court (ex. « Étape 3 »). */
export const captionSchema = z
  .object({
    text: z.string().min(1).max(600),
    label: z.string().min(1).max(80).optional(),
    align: z.enum(['start', 'center']).default('start'),
  })
  .strict();

/** Loupe : zone source circulaire agrandie, ancrée à un coin de la capture. */
export const zoomInsetSchema = z
  .object({
    source: z
      .object({
        cx: z.number().finite(),
        cy: z.number().finite(),
        radius: z.number().min(8).max(512),
      })
      .strict(),
    magnification: z.number().min(1.5).max(4).default(2),
    anchor: z
      .enum(['top-start', 'top-end', 'bottom-start', 'bottom-end'])
      .default('bottom-end'),
  })
  .strict();

/** Spécification complète d'une capture annotée. */
export const annotationSpecSchema = z
  .object({
    /** Dimensions en pixels de la capture BRUTE (avant habillage). */
    screenshot: z
      .object({
        width: z.number().int().min(16).max(8192),
        height: z.number().int().min(16).max(8192),
      })
      .strict(),
    /** Thème de l'habillage — le sombre est le défaut de marque. */
    theme: z.enum(['light', 'dark']).default('dark'),
    /** Langue de la légende — 'ar' bascule police arabe + RTL. */
    lang: z.enum(['fr', 'en', 'ar']).default('fr'),
    /** Fond autour de la capture ('transparent' pour composer sur une page). */
    backdrop: z.enum(['surfaceSubtle', 'background', 'transparent']).default('surfaceSubtle'),
    arrows: z.array(arrowSchema).max(12).default([]),
    badges: z.array(badgeSchema).max(20).default([]),
    highlights: z.array(highlightSchema).max(12).default([]),
    caption: captionSchema,
    zoomInset: zoomInsetSchema.optional(),
  })
  .strict();

export type Point = z.infer<typeof pointSchema>;
export type Arrow = z.infer<typeof arrowSchema>;
export type Badge = z.infer<typeof badgeSchema>;
export type Highlight = z.infer<typeof highlightSchema>;
export type Caption = z.infer<typeof captionSchema>;
export type ZoomInset = z.infer<typeof zoomInsetSchema>;
/** Spec résolue (défauts appliqués). */
export type AnnotationSpec = z.infer<typeof annotationSpecSchema>;
/** Spec acceptée en entrée (défauts optionnels). */
export type AnnotationSpecInput = z.input<typeof annotationSpecSchema>;

/* ------------------------------------------------------------------ */
/* Types du résultat                                                   */
/* ------------------------------------------------------------------ */

/** Bloc légende : SVG autonome + géométrie dans le canvas final. */
export interface CaptionBlock {
  /** SVG autonome de la légende seule (largeur = canvasWidth). */
  svg: string;
  /** Ordonnée du haut du bloc dans le canvas final. */
  y: number;
  /** Hauteur du bloc en px. */
  height: number;
  /** Nombre de lignes de texte (hors label). */
  lineCount: number;
}

/** Où poser la capture brute dans le canvas final. */
export interface ImagePlacement {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Rayon des coins — appliqué visuellement par le masque de l'overlay. */
  borderRadius: number;
}

/** Instructions sharp pour la loupe (extraction + repositionnement). */
export interface ZoomInsetPlacement {
  /** Région à extraire de la capture BRUTE (bornée à ses dimensions). */
  extract: { left: number; top: number; width: number; height: number };
  /** Diamètre cible (px) après agrandissement. */
  size: number;
  /** Position haut-gauche du cercle agrandi dans le canvas final. */
  composite: { left: number; top: number };
  /** Centre et rayon du cercle cible (repère canvas). */
  center: { cx: number; cy: number };
  radius: number;
}

/** Résultat complet de l'annotation. */
export interface AnnotatedScreenshot {
  overlaySvg: string;
  canvasWidth: number;
  canvasHeight: number;
  captionBlock: CaptionBlock;
  imagePlacement: ImagePlacement;
  zoomInsetPlacement?: ZoomInsetPlacement;
}

/* ------------------------------------------------------------------ */
/* Constantes de mise en page (dérivées des tokens)                    */
/* ------------------------------------------------------------------ */

/** Marge du cadre autour de la capture — spacing.16 (64px). */
const FRAME_PADDING = remToPx(tokens.spacing['16']);
/** Rayon des coins de la capture — radii.lg (16px). */
const FRAME_RADIUS = remToPx(tokens.radii.lg);
/** Espace entre capture et légende — spacing.6 (24px). */
const CAPTION_GAP = remToPx(tokens.spacing['6']);
/** Corps de la légende — fontSizes.sm. */
const CAPTION_FONT_SIZE = remToPx(tokens.typography.fontSizes.sm.size);
const CAPTION_LINE_HEIGHT = round2(
  CAPTION_FONT_SIZE * Number.parseFloat(tokens.typography.fontSizes.sm.lineHeight),
);
/** Sur-titre de légende — fontSizes.xs. */
const LABEL_FONT_SIZE = remToPx(tokens.typography.fontSizes.xs.size);
const LABEL_LINE_HEIGHT = round2(
  LABEL_FONT_SIZE * Number.parseFloat(tokens.typography.fontSizes.xs.lineHeight),
);
/** Rayon des coins de surbrillance rectangulaire — radii.sm (8px). */
const HIGHLIGHT_RADIUS = remToPx(tokens.radii.sm);

/* Géométrie pure (pas des couleurs) — valeurs accordées à la grille 4px. */
const BADGE_RADIUS = 14;
const ARROW_STROKE_WIDTH = 2.5;
const ARROW_HEAD_LENGTH = 12;
const ARROW_HEAD_ANGLE = (28 * Math.PI) / 180;

/*
 * Valeurs de MASQUE DE LUMINANCE SVG (white = visible, black = évidé).
 * Ce ne sont pas des couleurs de design : mots-clés CSS fonctionnels.
 */
const MASK_VISIBLE = 'white';
const MASK_HOLE = 'black';

/* ------------------------------------------------------------------ */
/* Rendu des primitives                                                */
/* ------------------------------------------------------------------ */

type SemanticThemeJson = (typeof tokens)['themes']['light'];

/** Couleur résolue d'un rôle de flèche pour un thème donné. */
function arrowColor(role: Arrow['color'], theme: SemanticThemeJson): string {
  switch (role) {
    case 'accent':
      return theme.accent;
    case 'foreground':
      return theme.foreground;
    default:
      return theme.primary;
  }
}

/**
 * Flèche courbe élégante : Bézier quadratique + pointe FINE en deux traits
 * (jamais de triangle plein). Coordonnées déjà translatées dans le canvas.
 */
function renderArrow(arrow: Arrow, offsetX: number, offsetY: number, theme: SemanticThemeJson): string {
  const x1 = arrow.from.x + offsetX;
  const y1 = arrow.from.y + offsetY;
  const x2 = arrow.to.x + offsetX;
  const y2 = arrow.to.y + offsetY;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);

  // Point de contrôle : milieu déporté perpendiculairement selon la courbure.
  const cx = (x1 + x2) / 2 + (-dy / length) * arrow.curvature * length * 0.5;
  const cy = (y1 + y2) / 2 + (dx / length) * arrow.curvature * length * 0.5;

  // Tangente à l'arrivée (t = 1) : direction contrôle → cible.
  const theta = Math.atan2(y2 - cy, x2 - cx);
  const h1x = x2 - ARROW_HEAD_LENGTH * Math.cos(theta - ARROW_HEAD_ANGLE);
  const h1y = y2 - ARROW_HEAD_LENGTH * Math.sin(theta - ARROW_HEAD_ANGLE);
  const h2x = x2 - ARROW_HEAD_LENGTH * Math.cos(theta + ARROW_HEAD_ANGLE);
  const h2y = y2 - ARROW_HEAD_LENGTH * Math.sin(theta + ARROW_HEAD_ANGLE);

  const stroke = arrowColor(arrow.color, theme);
  const common = `fill="none" stroke="${stroke}" stroke-width="${fmt(ARROW_STROKE_WIDTH)}" stroke-linecap="round" stroke-linejoin="round"`;
  return [
    `<path d="M ${fmt(x1)} ${fmt(y1)} Q ${fmt(cx)} ${fmt(cy)} ${fmt(x2)} ${fmt(y2)}" ${common}/>`,
    `<path d="M ${fmt(h1x)} ${fmt(h1y)} L ${fmt(x2)} ${fmt(y2)} L ${fmt(h2x)} ${fmt(h2y)}" ${common}/>`,
  ].join('');
}

/** Pastille numérotée violette avec halo de détachement couleur du fond. */
function renderBadge(
  badge: Badge,
  index: number,
  offsetX: number,
  offsetY: number,
  theme: SemanticThemeJson,
  haloColor: string,
): string {
  const cx = badge.x + offsetX;
  const cy = badge.y + offsetY;
  const label = String(badge.number ?? index + 1);
  return [
    '<g>',
    `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(BADGE_RADIUS + 2.5)}" fill="${haloColor}"/>`,
    `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(BADGE_RADIUS)}" fill="${theme.primary}"/>`,
    `<text x="${fmt(cx)}" y="${fmt(cy + 4.8)}" text-anchor="middle" font-family="${svgFontFamily('sans')}" font-size="13.5" font-weight="${tokens.typography.fontWeights.bold}" fill="${theme.primaryForeground}">${escapeXml(label)}</text>`,
    '</g>',
  ].join('');
}

/** Surbrillance or translucide — rectangle arrondi ou ellipse. */
function renderHighlight(
  highlight: Highlight,
  offsetX: number,
  offsetY: number,
  theme: SemanticThemeJson,
): string {
  const style = `fill="${theme.accent}" fill-opacity="0.22" stroke="${theme.accent}" stroke-opacity="0.9" stroke-width="1.5"`;
  if (highlight.shape === 'rect') {
    return `<rect x="${fmt(highlight.x + offsetX)}" y="${fmt(highlight.y + offsetY)}" width="${fmt(highlight.width)}" height="${fmt(highlight.height)}" rx="${fmt(HIGHLIGHT_RADIUS)}" ${style}/>`;
  }
  return `<ellipse cx="${fmt(highlight.cx + offsetX)}" cy="${fmt(highlight.cy + offsetY)}" rx="${fmt(highlight.rx)}" ry="${fmt(highlight.ry)}" ${style}/>`;
}

/* ------------------------------------------------------------------ */
/* Légende                                                             */
/* ------------------------------------------------------------------ */

interface CaptionLayout {
  lines: string[];
  height: number;
}

function measureCaption(caption: Caption): CaptionLayout {
  const lines = caption.text.split('\n');
  const labelHeight = caption.label ? LABEL_LINE_HEIGHT : 0;
  return {
    lines,
    height: Math.ceil(labelHeight + lines.length * CAPTION_LINE_HEIGHT),
  };
}

/**
 * Éléments <text> de la légende, positionnés à partir de `originY`.
 * Gère l'alignement logique start/center et le RTL arabe.
 */
function renderCaptionContent(
  caption: Caption,
  layout: CaptionLayout,
  originY: number,
  imageX: number,
  imageWidth: number,
  canvasWidth: number,
  isRtl: boolean,
  fontFamily: string,
  theme: SemanticThemeJson,
): string {
  const centered = caption.align === 'center';
  const x = centered ? canvasWidth / 2 : isRtl ? imageX + imageWidth : imageX;
  const anchor = centered ? 'middle' : isRtl ? 'end' : 'start';
  const direction = isRtl ? ' direction="rtl"' : '';

  const parts: string[] = [];
  let cursorY = originY;

  if (caption.label) {
    // Sur-titre or, petites capitales espacées — signature éditoriale.
    parts.push(
      `<text x="${fmt(x)}" y="${fmt(cursorY + LABEL_FONT_SIZE)}" text-anchor="${anchor}"${direction} font-family="${fontFamily}" font-size="${fmt(LABEL_FONT_SIZE)}" font-weight="${tokens.typography.fontWeights.semibold}" letter-spacing="1" fill="${theme.accent}">${escapeXml(isRtl ? caption.label : caption.label.toUpperCase())}</text>`,
    );
    cursorY += LABEL_LINE_HEIGHT;
  }

  for (const line of layout.lines) {
    parts.push(
      `<text x="${fmt(x)}" y="${fmt(cursorY + CAPTION_FONT_SIZE * 1.1)}" text-anchor="${anchor}"${direction} font-family="${fontFamily}" font-size="${fmt(CAPTION_FONT_SIZE)}" font-weight="${tokens.typography.fontWeights.regular}" fill="${theme.mutedForeground}">${escapeXml(line)}</text>`,
    );
    cursorY += CAPTION_LINE_HEIGHT;
  }

  return parts.join('');
}

/* ------------------------------------------------------------------ */
/* Loupe (zoom inset)                                                  */
/* ------------------------------------------------------------------ */

interface ZoomGeometry {
  placement: ZoomInsetPlacement;
  sourceRing: { cx: number; cy: number; r: number };
}

function computeZoomGeometry(
  zoom: ZoomInset,
  screenshot: { width: number; height: number },
  imageX: number,
  imageY: number,
  canvasWidth: number,
  canvasHeight: number,
  isRtl: boolean,
): ZoomGeometry {
  // Rayon cible plafonné pour que le cercle tienne TOUJOURS dans le canvas
  // (les petites captures ne peuvent pas accueillir une loupe géante).
  const targetRadius = round2(
    Math.min(
      zoom.source.radius * zoom.magnification,
      canvasWidth / 2 - 2,
      canvasHeight / 2 - 2,
    ),
  );

  // Ancre logique → physique (start = droite en RTL), centrée sur le coin du cadre.
  const [vertical, logical] = zoom.anchor.split('-') as ['top' | 'bottom', 'start' | 'end'];
  const physicalEnd = isRtl ? logical === 'start' : logical === 'end';
  let cx = physicalEnd ? imageX + screenshot.width : imageX;
  let cy = vertical === 'top' ? imageY : imageY + screenshot.height;
  cx = clamp(cx, targetRadius + 2, canvasWidth - targetRadius - 2);
  cy = clamp(cy, targetRadius + 2, canvasHeight - targetRadius - 2);

  // Région d'extraction bornée aux dimensions de la capture (exigence sharp).
  const side = Math.round(zoom.source.radius * 2);
  const extractWidth = Math.min(side, screenshot.width);
  const extractHeight = Math.min(side, screenshot.height);
  const extractLeft = clamp(Math.round(zoom.source.cx - zoom.source.radius), 0, screenshot.width - extractWidth);
  const extractTop = clamp(Math.round(zoom.source.cy - zoom.source.radius), 0, screenshot.height - extractHeight);

  const size = Math.round(targetRadius * 2);
  return {
    placement: {
      extract: { left: extractLeft, top: extractTop, width: extractWidth, height: extractHeight },
      size,
      composite: { left: Math.round(cx - targetRadius), top: Math.round(cy - targetRadius) },
      center: { cx: round2(cx), cy: round2(cy) },
      radius: targetRadius,
    },
    sourceRing: {
      cx: round2(zoom.source.cx + imageX),
      cy: round2(zoom.source.cy + imageY),
      r: zoom.source.radius,
    },
  };
}

/** Anneaux + connecteur de la loupe (le contenu agrandi est composé par sharp). */
function renderZoomChrome(geometry: ZoomGeometry, theme: SemanticThemeJson): string {
  const { sourceRing, placement } = geometry;
  const { cx, cy } = placement.center;
  const R = placement.radius;

  // Connecteur pointillé : du bord du cercle source au bord du cercle cible.
  const dx = cx - sourceRing.cx;
  const dy = cy - sourceRing.cy;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  const startX = sourceRing.cx + ux * sourceRing.r;
  const startY = sourceRing.cy + uy * sourceRing.r;
  const endX = cx - ux * (R + 4);
  const endY = cy - uy * (R + 4);

  return [
    `<circle cx="${fmt(sourceRing.cx)}" cy="${fmt(sourceRing.cy)}" r="${fmt(sourceRing.r)}" fill="none" stroke="${theme.primary}" stroke-width="2"/>`,
    `<line x1="${fmt(startX)}" y1="${fmt(startY)}" x2="${fmt(endX)}" y2="${fmt(endY)}" stroke="${theme.primary}" stroke-opacity="0.8" stroke-width="1.5" stroke-dasharray="4 4"/>`,
    `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(R)}" fill="none" stroke="${theme.primary}" stroke-width="3"/>`,
    `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(R + 3.5)}" fill="none" stroke="${theme.accent}" stroke-opacity="0.7" stroke-width="1.5"/>`,
  ].join('');
}

/**
 * Masque circulaire (SVG autonome) que le worker applique à l'extrait
 * agrandi de la loupe avant composition (sharp : blend 'dest-in').
 */
export function zoomInsetMaskSvg(diameter: number): string {
  const d = Math.max(1, Math.round(diameter));
  const r = d / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}" viewBox="0 0 ${d} ${d}"><circle cx="${fmt(r)}" cy="${fmt(r)}" r="${fmt(r)}" fill="${MASK_VISIBLE}"/></svg>`;
}

/* ------------------------------------------------------------------ */
/* API principale                                                      */
/* ------------------------------------------------------------------ */

/**
 * Construit l'habillage éditorial complet d'une capture : cadre à coins
 * arrondis sur fond subtil, ombre portée douce (tokens.shadows.xl),
 * flèches courbes, pastilles numérotées, surbrillances or, légende,
 * et loupe optionnelle. Fonction pure et déterministe.
 */
export function annotateScreenshot(input: AnnotationSpecInput): AnnotatedScreenshot {
  const spec = annotationSpecSchema.parse(input);
  const { width, height } = spec.screenshot;
  const theme = tokens.themes[spec.theme];
  const isRtl = spec.lang === 'ar';
  const captionFont = svgFontFamily(isRtl ? 'arabic' : 'sans');

  /* --- Mise en page ------------------------------------------------ */
  const imageX = FRAME_PADDING;
  const imageY = FRAME_PADDING;
  const canvasWidth = width + FRAME_PADDING * 2;
  const captionLayout = measureCaption(spec.caption);
  const captionY = imageY + height + CAPTION_GAP;
  const canvasHeight = Math.round(captionY + captionLayout.height + FRAME_PADDING);

  /* --- Loupe (géométrie avant rendu : son trou entre dans le masque) */
  const zoomGeometry = spec.zoomInset
    ? computeZoomGeometry(spec.zoomInset, spec.screenshot, imageX, imageY, canvasWidth, canvasHeight, isRtl)
    : undefined;

  /* --- Masque « extérieur » : fenêtre capture + cercle loupe évidés - */
  const maskHoles = [
    `<rect x="${fmt(imageX)}" y="${fmt(imageY)}" width="${fmt(width)}" height="${fmt(height)}" rx="${fmt(FRAME_RADIUS)}" fill="${MASK_HOLE}"/>`,
  ];
  if (zoomGeometry) {
    const { cx, cy } = zoomGeometry.placement.center;
    maskHoles.push(`<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(zoomGeometry.placement.radius)}" fill="${MASK_HOLE}"/>`);
  }
  const maskDef = [
    '<mask id="sc-ann-outside">',
    `<rect x="0" y="0" width="${canvasWidth}" height="${canvasHeight}" fill="${MASK_VISIBLE}"/>`,
    ...maskHoles,
    '</mask>',
  ].join('');

  /* --- Ombre portée douce depuis tokens.shadows.xl ------------------ */
  const shadowLayers = parseCssShadow(tokens.shadows.xl);
  const shadowDefs = shadowLayers
    .map(
      (layer, i) =>
        `<filter id="sc-ann-shadow-${i}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${fmt(layer.blur / 2)}"/></filter>`,
    )
    .join('');
  const shadowRects = shadowLayers
    .map((layer, i) => {
      const x = imageX + layer.offsetX - layer.spread;
      const y = imageY + layer.offsetY - layer.spread;
      const w = width + layer.spread * 2;
      const h = height + layer.spread * 2;
      const rx = Math.max(0, FRAME_RADIUS + layer.spread);
      const { r, g, b, alpha } = layer.color;
      return `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" rx="${fmt(rx)}" fill="rgb(${r},${g},${b})" fill-opacity="${fmt(alpha)}" filter="url(#sc-ann-shadow-${i})"/>`;
    })
    .join('');

  /* --- Fond subtil (évidé sur la fenêtre et la loupe) --------------- */
  const backdropColor =
    spec.backdrop === 'transparent'
      ? undefined
      : spec.backdrop === 'background'
        ? theme.background
        : theme.surfaceSubtle;
  const backdropRect = backdropColor
    ? `<rect x="0" y="0" width="${canvasWidth}" height="${canvasHeight}" fill="${backdropColor}"/>`
    : '';

  /* --- Liseré du cadre au-dessus de la capture ----------------------- */
  const frameBorder = `<rect x="${fmt(imageX)}" y="${fmt(imageY)}" width="${fmt(width)}" height="${fmt(height)}" rx="${fmt(FRAME_RADIUS)}" fill="none" stroke="${theme.border}" stroke-width="1.5"/>`;

  /* --- Annotations --------------------------------------------------- */
  const badgeHalo = backdropColor ?? theme.background;
  const highlightsSvg = spec.highlights.map((h) => renderHighlight(h, imageX, imageY, theme)).join('');
  const arrowsSvg = spec.arrows.map((a) => renderArrow(a, imageX, imageY, theme)).join('');
  const badgesSvg = spec.badges.map((b, i) => renderBadge(b, i, imageX, imageY, theme, badgeHalo)).join('');
  const zoomSvg = zoomGeometry ? renderZoomChrome(zoomGeometry, theme) : '';

  /* --- Légende -------------------------------------------------------- */
  const captionContent = renderCaptionContent(
    spec.caption, captionLayout, captionY, imageX, width, canvasWidth, isRtl, captionFont, theme,
  );
  const captionStandalone = renderCaptionContent(
    spec.caption, captionLayout, 0, imageX, width, canvasWidth, isRtl, captionFont, theme,
  );
  const captionBlock: CaptionBlock = {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${captionLayout.height}" viewBox="0 0 ${canvasWidth} ${captionLayout.height}">${captionStandalone}</svg>`,
    y: Math.round(captionY),
    height: captionLayout.height,
    lineCount: captionLayout.lines.length,
  };

  /* --- Assemblage ------------------------------------------------------ */
  const overlaySvg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}">`,
    `<defs>${maskDef}${shadowDefs}</defs>`,
    `<g mask="url(#sc-ann-outside)">${backdropRect}${shadowRects}</g>`,
    frameBorder,
    highlightsSvg,
    arrowsSvg,
    badgesSvg,
    zoomSvg,
    captionContent,
    '</svg>',
  ].join('');

  return {
    overlaySvg,
    canvasWidth,
    canvasHeight,
    captionBlock,
    imagePlacement: {
      left: imageX,
      top: imageY,
      width,
      height,
      borderRadius: FRAME_RADIUS,
    },
    ...(zoomGeometry ? { zoomInsetPlacement: zoomGeometry.placement } : {}),
  };
}
