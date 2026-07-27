// Tests légers du mapping slide → gabarit D7 (sans navigateur Playwright).
import { describe, expect, it } from 'vitest';
import { SlideTemplateEnum, type Slide } from '../shared.js';
import { buildSlideTemplate, labelsFor, type SlideRenderContext } from './slide-renderer.js';

const ctxFr: SlideRenderContext = {
  courseTitle: 'TypeScript avancé',
  locale: 'fr',
  lessonLabel: 'Leçon',
  lessonNumber: 4,
  sectionLabel: 'Partie',
  sectionNumber: 2,
  progress: 50,
};

function slide(partial: Partial<Slide>): Slide {
  return {
    template: 'content',
    title: 'Titre',
    bullets: ['a', 'b'],
    narration: 'narration',
    ...partial,
  };
}

describe('buildSlideTemplate — mapping template', () => {
  it('mappe chaque template de script sur son gabarit D7', () => {
    const cases: Array<[Slide['template'], string, Partial<Slide>?]> = [
      ['title', SlideTemplateEnum.Title],
      ['content', SlideTemplateEnum.Content],
      ['code', SlideTemplateEnum.Code],
      ['quote', SlideTemplateEnum.Quote],
      // 'diagram' sans schéma Mermaid dégrade en 'content' (E3) — le gabarit
      // Diagram n'est atteint qu'avec un slide.mermaid exploitable.
      ['diagram', SlideTemplateEnum.Diagram, { mermaid: { source: 'flowchart TD\nA-->B' } }],
      ['recap', SlideTemplateEnum.Recap],
      ['section-transition', SlideTemplateEnum.SectionTransition],
    ];
    for (const [template, expected, extra] of cases) {
      const built = buildSlideTemplate(slide({ template, ...extra }), ctxFr);
      expect(built.name).toBe(expected);
    }
  });

  it('injecte langue et direction ltr pour le français', () => {
    const built = buildSlideTemplate(slide({ template: 'content' }), ctxFr);
    expect((built.data as { lang: string }).lang).toBe('fr');
    expect((built.data as { direction: string }).direction).toBe('ltr');
  });

  it('passe en rtl et police arabe pour la locale ar', () => {
    const built = buildSlideTemplate(slide({ template: 'content' }), { ...ctxFr, locale: 'ar' });
    expect((built.data as { lang: string }).lang).toBe('ar');
    expect((built.data as { direction: string }).direction).toBe('rtl');
  });

  it('borne les bullets du gabarit content à 5 maximum', () => {
    const built = buildSlideTemplate(
      slide({ template: 'content', bullets: ['1', '2', '3', '4', '5', '6', '7'] }),
      ctxFr,
    );
    expect((built.data as { bullets: string[] }).bullets).toHaveLength(5);
  });

  it('coupe une comparison en deux colonnes gauche/droite', () => {
    const built = buildSlideTemplate(
      slide({ template: 'comparison', bullets: ['x1', 'x2', 'y1', 'y2'] }),
      ctxFr,
    );
    expect(built.name).toBe(SlideTemplateEnum.Comparison);
    const data = built.data as { left: { items: string[] }; right: { items: string[] } };
    expect(data.left.items.length).toBeGreaterThan(0);
    expect(data.right.items.length).toBeGreaterThan(0);
  });

  it('dégrade une comparison à une seule colonne en content', () => {
    const built = buildSlideTemplate(slide({ template: 'comparison', bullets: ['seul'] }), ctxFr);
    expect(built.name).toBe(SlideTemplateEnum.Content);
  });

  it('échappe le code injecté dans le gabarit code (pas de balise brute)', () => {
    const built = buildSlideTemplate(
      slide({ template: 'code', code: 'const x = a < b && c > d;', language: 'ts' }),
      ctxFr,
    );
    const html = (built.data as { codeHtml: string }).codeHtml;
    expect(html).not.toContain('<b');
    expect(html).toContain('&lt;');
    expect(html).toContain('&gt;');
    expect(html).toContain('&amp;');
  });

  it('fournit un langage par défaut si le script n\'en précise pas', () => {
    const built = buildSlideTemplate(slide({ template: 'code', code: 'x=1' }), ctxFr);
    expect((built.data as { language: string }).language).toBe('text');
  });

  it('remplit le numéro de section pour section-transition', () => {
    const built = buildSlideTemplate(slide({ template: 'section-transition' }), ctxFr);
    expect((built.data as { sectionNumber: number }).sectionNumber).toBe(2);
  });
});

describe('buildSlideTemplate — contenu enrichi (Prompt 83)', () => {
  it('rend une timeline en gabarit "timeline" quand slide.timeline est fourni', () => {
    const built = buildSlideTemplate(
      slide({
        template: 'diagram',
        timeline: {
          steps: [
            { date: '2023', label: 'Idée' },
            { date: '2024', label: 'Lancement' },
          ],
        },
      }),
      ctxFr,
    );
    expect(built.name).toBe('timeline');
    const data = built.data as { steps: Array<{ date: string; label: string }> };
    expect(data.steps).toHaveLength(2);
    expect(data.steps[0]?.date).toBe('2023');
  });

  it('rend un comparisonTable en gabarit "comparison" (2 colonnes)', () => {
    const built = buildSlideTemplate(
      slide({
        template: 'diagram',
        comparisonTable: {
          columns: ['REST', 'GraphQL'],
          rows: [{ label: 'Requêtes', values: ['multiples', 'une seule'] }],
        },
      }),
      ctxFr,
    );
    expect(built.name).toBe(SlideTemplateEnum.Comparison);
    const data = built.data as { left: { title: string }; right: { title: string } };
    expect(data.left.title).toBe('REST');
    expect(data.right.title).toBe('GraphQL');
  });

  it('dégrade un comparisonTable à une seule colonne en "content"', () => {
    const built = buildSlideTemplate(
      slide({
        template: 'diagram',
        comparisonTable: { columns: ['Seule'], rows: [{ label: 'x', values: ['1'] }] },
      }),
      ctxFr,
    );
    expect(built.name).toBe(SlideTemplateEnum.Content);
  });

  it('génère un SVG de repli mermaid quand slide.mermaid est fourni', () => {
    const built = buildSlideTemplate(
      slide({ template: 'diagram', mermaid: { source: 'flowchart TD\nA[Début] --> B[Fin]' } }),
      ctxFr,
    );
    expect(built.name).toBe(SlideTemplateEnum.Diagram);
    const html = (built.data as { diagramHtml: string }).diagramHtml;
    expect(html).toContain('<svg');
    expect(html).toContain('Début');
  });

  it('dégrade en "content" si aucun champ enrichi ni schéma Mermaid (E3, audit ESG 2026-07-19)', () => {
    // Avant E3 : le gabarit Diagram (cadre à coins vides pensé pour un SVG)
    // affichait 2-3 puces éparses dans un grand cadre quasi vide — visuellement
    // pauvre et quasi figé (Ken Burns sans effet mesurable sur un fond uni).
    // Le gabarit "content" (typographie dense) est la dégradation propre,
    // cohérente avec le cas 'comparison' à une seule colonne (test ci-dessus).
    const built = buildSlideTemplate(
      slide({ template: 'diagram', bullets: ['Étape 1', 'Étape 2'] }),
      ctxFr,
    );
    expect(built.name).toBe(SlideTemplateEnum.Content);
    const data = built.data as { bullets: string[] };
    expect(data.bullets).toEqual(['Étape 1', 'Étape 2']);
  });

  it('surligne les lignes actives du dernier pas de codeHighlightSteps', () => {
    const built = buildSlideTemplate(
      slide({
        template: 'code',
        code: 'const a = 1;\nconst b = 2;\nconst c = 3;',
        codeHighlightSteps: [{ lines: [0] }, { lines: [1, 2] }],
      }),
      ctxFr,
    );
    const html = (built.data as { codeHtml: string }).codeHtml;
    expect(html).toContain('class="line line-active"');
    // Ligne 0 (premier pas, pas le dernier) ne doit pas être active dans l'état final.
    const lines = html.split('\n');
    expect(lines[0]).not.toContain('line-active');
    expect(lines[1]).toContain('line-active');
    expect(lines[2]).toContain('line-active');
  });

  it('ne surligne aucune ligne sans codeHighlightSteps (comportement inchangé)', () => {
    const built = buildSlideTemplate(slide({ template: 'code', code: 'x = 1;' }), ctxFr);
    const html = (built.data as { codeHtml: string }).codeHtml;
    expect(html).not.toContain('line-active');
  });
});

describe('labelsFor — libellés localisés', () => {
  it('retourne les libellés français par défaut', () => {
    expect(labelsFor('fr')).toEqual({ lesson: 'Leçon', section: 'Partie' });
  });
  it('retourne les libellés anglais', () => {
    expect(labelsFor('en').lesson).toBe('Lesson');
  });
  it('retourne les libellés arabes', () => {
    expect(labelsFor('ar').lesson).toBe('الدرس');
  });
});
