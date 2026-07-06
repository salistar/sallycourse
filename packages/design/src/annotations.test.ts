/**
 * Tests unitaires — annotations.ts
 * Vérifie la validation zod, la géométrie du canvas, la conformité des
 * couleurs aux tokens et la structure SVG générée.
 */

import { describe, expect, it } from 'vitest';
import {
  annotateScreenshot,
  annotationSpecSchema,
  escapeXml,
  parseCssShadow,
  svgFontFamily,
  zoomInsetMaskSvg,
  type AnnotationSpecInput,
} from './annotations';
import tokens from './tokens.json';

/** Spec minimale valide, à étendre par test. */
function baseSpec(overrides: Partial<AnnotationSpecInput> = {}): AnnotationSpecInput {
  return {
    screenshot: { width: 1280, height: 720 },
    caption: { text: 'Ouvrir le panneau des extensions.' },
    ...overrides,
  };
}

/** Ensemble de tous les hex autorisés (échelles + thèmes de tokens.json). */
function tokenHexSet(): Set<string> {
  const set = new Set<string>();
  const collect = (value: unknown): void => {
    if (typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value)) {
      set.add(value.toUpperCase());
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(collect);
    }
  };
  collect(tokens.colors);
  collect(tokens.themes);
  return set;
}

describe('annotationSpecSchema — validation', () => {
  it('accepte une spec minimale et applique les défauts', () => {
    const parsed = annotationSpecSchema.parse(baseSpec());
    expect(parsed.theme).toBe('dark');
    expect(parsed.lang).toBe('fr');
    expect(parsed.backdrop).toBe('surfaceSubtle');
    expect(parsed.arrows).toEqual([]);
    expect(parsed.badges).toEqual([]);
    expect(parsed.highlights).toEqual([]);
    expect(parsed.caption.align).toBe('start');
  });

  it('rejette une largeur de capture nulle ou négative', () => {
    expect(() => annotateScreenshot(baseSpec({ screenshot: { width: 0, height: 720 } }))).toThrow();
  });

  it('rejette les clés inconnues (schémas stricts)', () => {
    expect(() =>
      annotationSpecSchema.parse({ ...baseSpec(), inconnu: true } as never),
    ).toThrow();
  });

  it('rejette une légende vide', () => {
    expect(() => annotateScreenshot(baseSpec({ caption: { text: '' } }))).toThrow();
  });

  it('rejette un numéro de pastille hors bornes', () => {
    expect(() =>
      annotateScreenshot(baseSpec({ badges: [{ x: 10, y: 10, number: 0 }] })),
    ).toThrow();
    expect(() =>
      annotateScreenshot(baseSpec({ badges: [{ x: 10, y: 10, number: 100 }] })),
    ).toThrow();
  });

  it('rejette une magnification hors 1.5–4', () => {
    expect(() =>
      annotateScreenshot(
        baseSpec({ zoomInset: { source: { cx: 100, cy: 100, radius: 40 }, magnification: 5 } }),
      ),
    ).toThrow();
  });

  it('rejette une flèche dégénérée (from ≈ to)', () => {
    expect(() =>
      annotateScreenshot(baseSpec({ arrows: [{ from: { x: 10, y: 10 }, to: { x: 12, y: 11 } }] })),
    ).toThrow();
  });
});

describe('annotateScreenshot — géométrie du canvas', () => {
  it('calcule canvasWidth = capture + 2 × marge (64px)', () => {
    const result = annotateScreenshot(baseSpec());
    expect(result.canvasWidth).toBe(1280 + 128);
  });

  it('calcule canvasHeight = marge + capture + écart + légende + marge', () => {
    const result = annotateScreenshot(baseSpec());
    expect(result.canvasHeight).toBe(64 + 720 + 24 + result.captionBlock.height + 64);
  });

  it('place la capture à (64, 64) avec un rayon de coins de 16px', () => {
    const { imagePlacement } = annotateScreenshot(baseSpec());
    expect(imagePlacement).toEqual({ left: 64, top: 64, width: 1280, height: 720, borderRadius: 16 });
  });

  it('grandit avec une légende multi-lignes', () => {
    const oneLine = annotateScreenshot(baseSpec());
    const threeLines = annotateScreenshot(
      baseSpec({ caption: { text: 'Ligne 1\nLigne 2\nLigne 3' } }),
    );
    expect(threeLines.captionBlock.lineCount).toBe(3);
    expect(threeLines.captionBlock.height).toBeGreaterThan(oneLine.captionBlock.height);
    expect(threeLines.canvasHeight).toBeGreaterThan(oneLine.canvasHeight);
  });
});

describe('annotateScreenshot — structure SVG', () => {
  it('produit un SVG plein cadre avec xmlns et viewBox cohérent', () => {
    const result = annotateScreenshot(baseSpec());
    expect(result.overlaySvg.startsWith('<svg ')).toBe(true);
    expect(result.overlaySvg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(result.overlaySvg).toContain(`viewBox="0 0 ${result.canvasWidth} ${result.canvasHeight}"`);
    expect(result.overlaySvg.endsWith('</svg>')).toBe(true);
  });

  it("n'utilise QUE des hex issus de tokens.json", () => {
    const result = annotateScreenshot(
      baseSpec({
        arrows: [{ from: { x: 100, y: 100 }, to: { x: 300, y: 200 }, color: 'accent' }],
        badges: [{ x: 50, y: 50 }],
        highlights: [{ shape: 'rect', x: 10, y: 10, width: 200, height: 80 }],
        zoomInset: { source: { cx: 200, cy: 200, radius: 40 } },
        caption: { text: 'Test', label: 'Étape 1' },
      }),
    );
    const allowed = tokenHexSet();
    const used = result.overlaySvg.match(/#[0-9A-Fa-f]{6}/g) ?? [];
    expect(used.length).toBeGreaterThan(0);
    for (const hex of used) {
      expect(allowed.has(hex.toUpperCase())).toBe(true);
    }
  });

  it('peint le fond subtil, le masque-fenêtre et l’ombre issue des tokens', () => {
    const result = annotateScreenshot(baseSpec());
    expect(result.overlaySvg).toContain(tokens.themes.dark.surfaceSubtle);
    expect(result.overlaySvg).toContain('mask="url(#sc-ann-outside)"');
    expect(result.overlaySvg).toContain('feGaussianBlur');
    // Couleur d'ombre violette des tokens : rgb(37 15 58 / 0.22) → rgb(37,15,58).
    expect(result.overlaySvg).toContain('rgb(37,15,58)');
  });

  it('omet le fond en backdrop transparent (mais garde l’ombre)', () => {
    const result = annotateScreenshot(baseSpec({ backdrop: 'transparent' }));
    expect(result.overlaySvg).not.toContain(tokens.themes.dark.surfaceSubtle);
    expect(result.overlaySvg).toContain('feGaussianBlur');
  });

  it('diffère entre thème light et dark', () => {
    const dark = annotateScreenshot(baseSpec());
    const light = annotateScreenshot(baseSpec({ theme: 'light' }));
    expect(dark.overlaySvg).not.toBe(light.overlaySvg);
    expect(light.overlaySvg).toContain(tokens.themes.light.surfaceSubtle);
  });
});

describe('annotateScreenshot — flèches courbes', () => {
  it('trace une Bézier quadratique + pointe fine en deux traits', () => {
    const result = annotateScreenshot(
      baseSpec({ arrows: [{ from: { x: 100, y: 100 }, to: { x: 400, y: 300 } }] }),
    );
    const quadratics = result.overlaySvg.match(/ Q /g) ?? [];
    expect(quadratics.length).toBe(1);
    // Deux <path> par flèche : le fût + la pointe (M … L tip L …).
    const heads = result.overlaySvg.match(/<path d="M [^"]+ L [^"]+ L [^"]+"/g) ?? [];
    expect(heads.length).toBe(1);
    expect(result.overlaySvg).toContain('stroke-linecap="round"');
  });

  it('respecte le rôle de couleur de chaque flèche', () => {
    const result = annotateScreenshot(
      baseSpec({
        arrows: [
          { from: { x: 0, y: 0 }, to: { x: 100, y: 100 }, color: 'primary' },
          { from: { x: 0, y: 50 }, to: { x: 100, y: 150 }, color: 'accent' },
        ],
      }),
    );
    expect(result.overlaySvg).toContain(`stroke="${tokens.themes.dark.primary}"`);
    expect(result.overlaySvg).toContain(`stroke="${tokens.themes.dark.accent}"`);
  });
});

describe('annotateScreenshot — pastilles numérotées', () => {
  it('numérote automatiquement 1, 2, 3 selon l’ordre du tableau', () => {
    const result = annotateScreenshot(
      baseSpec({ badges: [{ x: 10, y: 10 }, { x: 40, y: 40 }, { x: 80, y: 80 }] }),
    );
    expect(result.overlaySvg).toContain('>1</text>');
    expect(result.overlaySvg).toContain('>2</text>');
    expect(result.overlaySvg).toContain('>3</text>');
  });

  it('respecte un numéro explicite et remplit en violet primaire', () => {
    const result = annotateScreenshot(baseSpec({ badges: [{ x: 10, y: 10, number: 7 }] }));
    expect(result.overlaySvg).toContain('>7</text>');
    expect(result.overlaySvg).toContain(`fill="${tokens.themes.dark.primary}"`);
  });

  it('translate les coordonnées capture → canvas (offset 64px)', () => {
    const result = annotateScreenshot(baseSpec({ badges: [{ x: 100, y: 50 }] }));
    expect(result.overlaySvg).toContain('cx="164"');
    expect(result.overlaySvg).toContain('cy="114"');
  });
});

describe('annotateScreenshot — surbrillances or', () => {
  it('rend un rect arrondi translucide couleur accent', () => {
    const result = annotateScreenshot(
      baseSpec({ highlights: [{ shape: 'rect', x: 20, y: 30, width: 150, height: 60 }] }),
    );
    expect(result.overlaySvg).toContain(`fill="${tokens.themes.dark.accent}" fill-opacity="0.22"`);
    expect(result.overlaySvg).toContain('rx="8"');
  });

  it('rend une ellipse quand shape=ellipse', () => {
    const result = annotateScreenshot(
      baseSpec({ highlights: [{ shape: 'ellipse', cx: 200, cy: 100, rx: 80, ry: 40 }] }),
    );
    expect(result.overlaySvg).toContain('<ellipse ');
  });
});

describe('annotateScreenshot — légende', () => {
  it('échappe le XML du texte utilisateur', () => {
    const result = annotateScreenshot(
      baseSpec({ caption: { text: 'Fichier > "Ouvrir" & <valider>' } }),
    );
    expect(result.overlaySvg).toContain('Fichier &gt; &quot;Ouvrir&quot; &amp; &lt;valider&gt;');
    expect(result.overlaySvg).not.toContain('<valider>');
  });

  it('rend le label en or, en capitales, au-dessus du texte', () => {
    const result = annotateScreenshot(
      baseSpec({ caption: { text: 'Le terminal intégré.', label: 'Étape 2' } }),
    );
    expect(result.overlaySvg).toContain('ÉTAPE 2');
    expect(result.overlaySvg).toContain(`fill="${tokens.themes.dark.accent}"`);
  });

  it('centre la légende quand align=center', () => {
    const result = annotateScreenshot(
      baseSpec({ caption: { text: 'Centré.', align: 'center' } }),
    );
    expect(result.overlaySvg).toContain('text-anchor="middle"');
  });

  it('fournit un captionBlock SVG autonome cohérent', () => {
    const result = annotateScreenshot(baseSpec());
    expect(result.captionBlock.svg.startsWith('<svg ')).toBe(true);
    expect(result.captionBlock.svg).toContain(`height="${result.captionBlock.height}"`);
    expect(result.captionBlock.y).toBe(64 + 720 + 24);
  });
});

describe('annotateScreenshot — arabe / RTL', () => {
  it('bascule police arabe + direction rtl + ancrage fin', () => {
    const result = annotateScreenshot(
      baseSpec({ lang: 'ar', caption: { text: 'افتح لوحة الإضافات.' } }),
    );
    expect(result.overlaySvg).toContain('IBM Plex Sans Arabic');
    expect(result.overlaySvg).toContain('direction="rtl"');
    expect(result.overlaySvg).toContain('text-anchor="end"');
  });

  it('ne met jamais le label arabe en majuscules latines', () => {
    const label = 'الخطوة ٣';
    const result = annotateScreenshot(
      baseSpec({ lang: 'ar', caption: { text: 'نص', label } }),
    );
    expect(result.overlaySvg).toContain(label);
  });
});

describe('annotateScreenshot — loupe (zoom inset)', () => {
  it('calcule un diamètre cible = 2 × rayon × magnification', () => {
    const result = annotateScreenshot(
      baseSpec({ zoomInset: { source: { cx: 300, cy: 200, radius: 40 }, magnification: 2 } }),
    );
    expect(result.zoomInsetPlacement).toBeDefined();
    expect(result.zoomInsetPlacement?.size).toBe(160);
    expect(result.zoomInsetPlacement?.radius).toBe(80);
  });

  it('borne la région d’extraction aux dimensions de la capture', () => {
    const result = annotateScreenshot(
      baseSpec({
        screenshot: { width: 400, height: 300 },
        zoomInset: { source: { cx: 390, cy: 10, radius: 40 } },
      }),
    );
    const extract = result.zoomInsetPlacement?.extract;
    expect(extract).toBeDefined();
    if (!extract) return;
    expect(extract.left).toBeGreaterThanOrEqual(0);
    expect(extract.top).toBeGreaterThanOrEqual(0);
    expect(extract.left + extract.width).toBeLessThanOrEqual(400);
    expect(extract.top + extract.height).toBeLessThanOrEqual(300);
  });

  it('dessine anneau source, connecteur pointillé et double anneau cible', () => {
    const result = annotateScreenshot(
      baseSpec({ zoomInset: { source: { cx: 300, cy: 200, radius: 40 } } }),
    );
    expect(result.overlaySvg).toContain('stroke-dasharray="4 4"');
    const circles = result.overlaySvg.match(/<circle /g) ?? [];
    // 1 source + 1 cible + 1 anneau or + 1 trou de masque = 4 minimum.
    expect(circles.length).toBeGreaterThanOrEqual(4);
  });

  it('évide aussi le cercle de la loupe dans le masque-fenêtre', () => {
    const withZoom = annotateScreenshot(
      baseSpec({ zoomInset: { source: { cx: 300, cy: 200, radius: 40 } } }),
    );
    const maskSection = withZoom.overlaySvg.slice(
      withZoom.overlaySvg.indexOf('<mask'),
      withZoom.overlaySvg.indexOf('</mask>'),
    );
    expect(maskSection).toContain('<circle');
  });

  it('reste dans le canvas (clamp) même avec une grande loupe', () => {
    const result = annotateScreenshot(
      baseSpec({
        screenshot: { width: 640, height: 480 },
        zoomInset: { source: { cx: 620, cy: 460, radius: 100 }, magnification: 4 },
      }),
    );
    const p = result.zoomInsetPlacement;
    expect(p).toBeDefined();
    if (!p) return;
    expect(p.composite.left).toBeGreaterThanOrEqual(0);
    expect(p.composite.top).toBeGreaterThanOrEqual(0);
    expect(p.composite.left + p.size).toBeLessThanOrEqual(result.canvasWidth);
    expect(p.composite.top + p.size).toBeLessThanOrEqual(result.canvasHeight);
  });
});

describe('helpers', () => {
  it('parseCssShadow décompose tokens.shadows.xl', () => {
    const layers = parseCssShadow(tokens.shadows.xl);
    expect(layers).toEqual([
      { offsetX: 0, offsetY: 16, blur: 48, spread: -12, color: { r: 37, g: 15, b: 58, alpha: 0.22 } },
    ]);
  });

  it('parseCssShadow gère les ombres multi-couches (tokens.shadows.md)', () => {
    const layers = parseCssShadow(tokens.shadows.md);
    expect(layers).toHaveLength(2);
    expect(layers[0]?.blur).toBe(8);
    expect(layers[1]?.offsetY).toBe(1);
  });

  it('escapeXml neutralise les cinq caractères réservés', () => {
    expect(escapeXml(`<a b="c" & 'd'>`)).toBe('&lt;a b=&quot;c&quot; &amp; &apos;d&apos;&gt;');
  });

  it('svgFontFamily retire les var(--font-*) et garde la pile token', () => {
    const sans = svgFontFamily('sans');
    expect(sans).not.toContain('var(');
    expect(sans).toContain('Figtree');
    expect(svgFontFamily('arabic')).toContain('IBM Plex Sans Arabic');
  });

  it('zoomInsetMaskSvg produit un disque plein du bon diamètre', () => {
    const svg = zoomInsetMaskSvg(160);
    expect(svg).toContain('width="160"');
    expect(svg).toContain('r="80"');
    expect(svg).toContain('fill="white"');
  });
});
