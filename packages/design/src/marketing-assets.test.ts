/**
 * Tests unitaires — marketing-assets.ts
 * Couvre : validation zod, déterminisme du seed, variation de motif,
 * fit du texte (réduction par paliers + wrap 2 lignes), contraste WCAG,
 * contrainte "4 mots max" YouTube, dimensions et conformité des couleurs
 * aux tokens.
 */

import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  courseImageSpecSchema,
  createRng,
  ensureContrast,
  estimateTextWidth,
  fitText,
  generateCourseImage,
  hashSeed,
  limitWords,
  marketingFormats,
  motifFamilies,
  pickMotifVariation,
  relativeLuminance,
  type CourseImageSpecInput,
} from './marketing-assets';
import tokens from './tokens.json';

/** Spec minimale valide, à étendre par test. */
function baseSpec(overrides: Partial<CourseImageSpecInput> = {}): CourseImageSpecInput {
  return {
    title: 'Maîtriser TypeScript en profondeur',
    format: 'udemy',
    ...overrides,
  };
}

/** Ensemble de tous les hex autorisés (échelles + thèmes des tokens). */
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

/* ------------------------------------------------------------------ */
/* Validation zod                                                      */
/* ------------------------------------------------------------------ */

describe('courseImageSpecSchema — validation', () => {
  it('accepte une spec minimale et applique les défauts', () => {
    const parsed = courseImageSpecSchema.parse(baseSpec());
    expect(parsed.lang).toBe('fr');
    expect(parsed.format).toBe('udemy');
  });

  it('rejette un titre vide et les clés inconnues (schéma strict)', () => {
    expect(() => courseImageSpecSchema.parse(baseSpec({ title: '   ' }))).toThrow();
    expect(() =>
      courseImageSpecSchema.parse({ ...baseSpec(), inconnue: true } as CourseImageSpecInput),
    ).toThrow();
  });

  it('rejette un format non supporté', () => {
    expect(() =>
      courseImageSpecSchema.parse({ ...baseSpec(), format: 'tiktok' } as unknown as CourseImageSpecInput),
    ).toThrow();
  });
});

/* ------------------------------------------------------------------ */
/* Déterminisme du seed                                                */
/* ------------------------------------------------------------------ */

describe('déterminisme du seed', () => {
  it('hashSeed est stable et distingue des titres proches', () => {
    expect(hashSeed('Python avancé')).toBe(hashSeed('Python avancé'));
    expect(hashSeed('Python avancé')).not.toBe(hashSeed('Python avance'));
  });

  it('createRng produit la même suite pour un même seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 8 }, () => a());
    const seqB = Array.from({ length: 8 }, () => b());
    expect(seqA).toEqual(seqB);
    seqA.forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    });
  });

  it('pickMotifVariation est déterministe et reste dans les bornes', () => {
    const v1 = pickMotifVariation(hashSeed('Docker de zéro à héros'));
    const v2 = pickMotifVariation(hashSeed('Docker de zéro à héros'));
    expect(v1).toEqual(v2);
    expect(motifFamilies).toContain(v1.family);
    expect(v1.density).toBeGreaterThanOrEqual(0.25);
    expect(v1.density).toBeLessThanOrEqual(1);
  });

  it('des titres différents produisent plusieurs familles de motifs', () => {
    const titles = [
      'Python pour la data science',
      'React 19 en pratique',
      'Kubernetes avancé',
      'SQL de zéro à expert',
      'Design system avec Figma',
      'Rust embarqué',
      'Machine learning appliqué',
      'DevOps avec GitHub Actions',
      'Comptabilité marocaine CGNC',
      'Photographie de portrait',
      'Arabe littéraire niveau 1',
      'Négociation commerciale',
      'Excel financier',
      'Sécurité offensive web',
      'Montage vidéo DaVinci',
      'Prise de parole en public',
    ];
    const families = new Set(titles.map((t) => pickMotifVariation(hashSeed(t)).family));
    expect(families.size).toBeGreaterThanOrEqual(3);
  });

  it('generateCourseImage : même spec → même SVG, titres différents → SVG différents', () => {
    const spec = baseSpec({ format: 'youtube' });
    expect(generateCourseImage(spec)).toBe(generateCourseImage(spec));
    expect(generateCourseImage(baseSpec({ title: 'Cours A totalement unique' }))).not.toBe(
      generateCourseImage(baseSpec({ title: 'Cours B totalement autre' })),
    );
  });

  it('le seed explicite prime sur le titre pour la variation', () => {
    const a = generateCourseImage(baseSpec({ seed: 'graine-fixe' }));
    const b = generateCourseImage(baseSpec({ title: 'Titre complètement différent', seed: 'graine-fixe' }));
    // Même motif (même seed) mais textes différents : les defs/motifs partagent le même id de seed.
    const idOf = (svg: string): string => svg.match(/id="(sc[0-9a-z]+)-bg"/)?.[1] ?? '';
    expect(idOf(a)).toBe(idOf(b));
    expect(idOf(a)).not.toBe('');
  });
});

/* ------------------------------------------------------------------ */
/* Fit du texte                                                        */
/* ------------------------------------------------------------------ */

describe('fitText — équilibrage automatique', () => {
  it('conserve la taille maximale pour un texte court', () => {
    const fit = fitText('SQL', { maxWidth: 600, maxFontSize: 80, minFontSize: 30 });
    expect(fit.fontSize).toBe(80);
    expect(fit.lines).toEqual(['SQL']);
    expect(fit.truncated).toBe(false);
  });

  it('réduit par paliers et wrappe sur 2 lignes max pour un texte long', () => {
    const text = 'Construire des applications web modernes avec React et TypeScript';
    const fit = fitText(text, { maxWidth: 620, maxFontSize: 80, minFontSize: 24 });
    expect(fit.fontSize).toBeLessThan(80);
    expect(fit.fontSize).toBeGreaterThanOrEqual(24);
    expect(fit.lines.length).toBeLessThanOrEqual(2);
    expect(fit.truncated).toBe(false);
    // Chaque ligne tient dans la largeur allouée à la taille retenue.
    for (const line of fit.lines) {
      expect(estimateTextWidth(line, fit.fontSize)).toBeLessThanOrEqual(620);
    }
    // Aucun mot perdu.
    expect(fit.lines.join(' ')).toBe(text);
  });

  it('tronque avec ellipse au plancher pour un texte impossible à caser', () => {
    const text = 'Anticonstitutionnellement '.repeat(12).trim();
    const fit = fitText(text, { maxWidth: 200, maxFontSize: 40, minFontSize: 20 });
    expect(fit.fontSize).toBe(20);
    expect(fit.lines.length).toBeLessThanOrEqual(2);
    expect(fit.truncated).toBe(true);
    expect(fit.lines[fit.lines.length - 1]).toMatch(/…$/);
    for (const line of fit.lines) {
      expect(estimateTextWidth(line, fit.fontSize)).toBeLessThanOrEqual(200);
    }
  });

  it('estimateTextWidth croît avec la taille et la graisse', () => {
    const w = estimateTextWidth('Formation', 20);
    expect(estimateTextWidth('Formation', 40)).toBeCloseTo(w * 2, 5);
    expect(estimateTextWidth('Formation', 20, true)).toBeGreaterThan(w);
    expect(estimateTextWidth('', 40)).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Contraste WCAG                                                      */
/* ------------------------------------------------------------------ */

describe('contraste WCAG', () => {
  const violet950 = tokens.colors.violet['950'];
  const neutral50 = tokens.colors.neutral['50'];

  it('relativeLuminance : bornes connues', () => {
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
  });

  it('contrastRatio : symétrique, identité à 1, blanc/noir à 21', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 1);
    expect(contrastRatio(violet950, neutral50)).toBeCloseTo(contrastRatio(neutral50, violet950), 10);
    expect(contrastRatio(violet950, violet950)).toBeCloseTo(1, 10);
  });

  it('le texte clair sur fond violet profond dépasse 4.5', () => {
    expect(contrastRatio(neutral50, violet950)).toBeGreaterThanOrEqual(4.5);
  });

  it('ensureContrast garde la couleur si le ratio suffit, sinon ajuste à >= 4.5', () => {
    expect(ensureContrast(neutral50, violet950)).toBe(neutral50);
    const adjusted = ensureContrast(tokens.colors.violet['800'], violet950);
    expect(adjusted).not.toBe(tokens.colors.violet['800']);
    expect(contrastRatio(adjusted, violet950)).toBeGreaterThanOrEqual(4.5);
  });
});

/* ------------------------------------------------------------------ */
/* Contraintes par format                                              */
/* ------------------------------------------------------------------ */

describe('generateCourseImage — formats et contraintes', () => {
  it('émet les bonnes dimensions pour chaque format', () => {
    (Object.keys(marketingFormats) as Array<keyof typeof marketingFormats>).forEach((format) => {
      const { width, height } = marketingFormats[format];
      const svg = generateCourseImage(baseSpec({ format }));
      expect(svg.startsWith('<svg ')).toBe(true);
      expect(svg.endsWith('</svg>')).toBe(true);
      expect(svg).toContain(`width="${width}"`);
      expect(svg).toContain(`height="${height}"`);
      expect(svg).toContain(`viewBox="0 0 ${width} ${height}"`);
    });
  });

  it('miniature YouTube : 4 mots max affichés', () => {
    const title = 'Apprendre le développement web fullstack moderne pas à pas';
    expect(limitWords(title, 4)).toBe('Apprendre le développement web');
    const youtube = generateCourseImage(baseSpec({ title, format: 'youtube' }));
    const og = generateCourseImage(baseSpec({ title, format: 'og' }));
    // Seuls les nœuds <text> comptent : l'aria-label conserve le titre complet.
    const renderedText = (svg: string): string =>
      [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1] ?? '').join(' ');
    const shown = renderedText(youtube).replace('SALISTAR', '').trim();
    // Le 5e mot ("fullstack") ne doit apparaître QUE hors YouTube.
    expect(shown.toUpperCase()).not.toContain('FULLSTACK');
    expect(shown.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(4);
    expect(renderedText(og)).toContain('fullstack');
  });

  it('échappe le XML dans le titre, le sous-titre et le badge', () => {
    const svg = generateCourseImage(
      baseSpec({ title: 'C# & <génériques>', subtitle: 'Types "sûrs" & unions', badge: '<Niv. 2>' }),
    );
    expect(svg).not.toContain('<génériques>');
    expect(svg).toContain('&lt;génériques&gt;');
    expect(svg).toContain('&amp;');
  });

  it('empile le badge SOUS la marque en layout centré, sans chevauchement (correctif 1.6, audit 2026-07-20)', () => {
    // Youtube ET story sont "centered" — brand et badge partagent le même X
    // (width/2) ; avant le correctif ils partageaient aussi le même Y et se
    // superposaient/s'entremêlaient visuellement.
    for (const format of ['youtube', 'story'] as const) {
      const svg = generateCourseImage(baseSpec({ format, badge: 'Débutant' }));
      const brandMatch = svg.match(/<text x="[\d.]+" y="([\d.]+)"[^>]*>SALISTAR<\/text>/);
      const badgeMatch = svg.match(/<rect x="[\d.]+" y="([\d.]+)"[^>]*stroke="[^"]+"[^>]*\/>/);
      expect(brandMatch, format).not.toBeNull();
      expect(badgeMatch, format).not.toBeNull();
      const brandY = Number(brandMatch![1]);
      const badgeY = Number(badgeMatch![1]);
      expect(badgeY, `${format}: badgeY doit être sous brandY`).toBeGreaterThan(brandY);
    }
  });

  it('badge en layout non centré (udemy) reste au même niveau que la marque — déjà séparés horizontalement', () => {
    const svg = generateCourseImage(baseSpec({ format: 'udemy', badge: 'Débutant' }));
    const brandMatch = svg.match(/<text x="[\d.]+" y="([\d.]+)"[^>]*>SALISTAR<\/text>/);
    const badgeMatch = svg.match(/<rect x="[\d.]+" y="([\d.]+)"[^>]*stroke="[^"]+"[^>]*\/>/);
    expect(Number(badgeMatch![1])).toBe(Number(brandMatch![1]) - 15); // pad(44) vs brandY=pad+brandSize(15)
  });

  it('bascule en RTL pour l’arabe (ancrage fin + police arabe, jamais de serif)', () => {
    const svg = generateCourseImage(
      baseSpec({ title: 'تعلم البرمجة من الصفر', lang: 'ar', subtitle: 'دورة شاملة للمبتدئين' }),
    );
    expect(svg).toContain('direction="rtl"');
    expect(svg).toContain('IBM Plex Sans Arabic');
    expect(svg).not.toContain('Fraunces');
  });

  it('n’utilise que des couleurs hex issues des tokens', () => {
    const allowed = tokenHexSet();
    const specs: CourseImageSpecInput[] = (
      ['udemy', 'youtube', 'og', 'story'] as const
    ).map((format) => baseSpec({ format, subtitle: 'Du niveau débutant au niveau avancé', badge: 'Nouveau' }));
    for (const spec of specs) {
      const svg = generateCourseImage(spec);
      const hexes = svg.match(/#[0-9A-Fa-f]{6}/g) ?? [];
      expect(hexes.length).toBeGreaterThan(0);
      for (const hex of hexes) {
        expect(allowed.has(hex.toUpperCase())).toBe(true);
      }
    }
  });

  it('couvre les 6 familles de motifs via des seeds explicites (rendu sans erreur)', () => {
    // Balaye des seeds jusqu'à avoir vu chaque famille au moins une fois.
    const seen = new Set<string>();
    for (let i = 0; i < 500 && seen.size < motifFamilies.length; i += 1) {
      const seed = `seed-${i}`;
      const { family } = pickMotifVariation(hashSeed(seed));
      if (!seen.has(family)) {
        seen.add(family);
        const svg = generateCourseImage(baseSpec({ seed, format: 'story' }));
        expect(svg).toContain('</svg>');
      }
    }
    expect(seen.size).toBe(motifFamilies.length);
  });
});
