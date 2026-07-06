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
    const cases: Array<[Slide['template'], string]> = [
      ['title', SlideTemplateEnum.Title],
      ['content', SlideTemplateEnum.Content],
      ['code', SlideTemplateEnum.Code],
      ['quote', SlideTemplateEnum.Quote],
      ['diagram', SlideTemplateEnum.Diagram],
      ['recap', SlideTemplateEnum.Recap],
      ['section-transition', SlideTemplateEnum.SectionTransition],
    ];
    for (const [template, expected] of cases) {
      const built = buildSlideTemplate(slide({ template }), ctxFr);
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
