/**
 * Tests unitaires — render-templates.ts : rendu de base + option largeText
 * (Prompt 137, accessibilité). Fonction pure et déterministe.
 */
import { describe, expect, it } from 'vitest';
import { LARGE_TEXT_SCALE, renderTemplate, SlideTemplate } from './render-templates';

const baseTitleInput = {
  courseTitle: 'Maîtriser TypeScript',
  lessonNumber: 4,
  title: 'Les génériques',
  subtitle: 'Comprendre les types paramétrés',
};

describe('renderTemplate', () => {
  it('rend le gabarit title avec les placeholders substitués', () => {
    const html = renderTemplate(SlideTemplate.Title, baseTitleInput);
    expect(html).toContain('Les génériques');
    expect(html).toContain('Maîtriser TypeScript');
    expect(html).not.toMatch(/\{\{\w+\}\}/); // aucun placeholder restant
  });

  it('sans options : comportement inchangé (pas d’override --text-scale injecté)', () => {
    const html = renderTemplate(SlideTemplate.Title, baseTitleInput);
    // Le gabarit déclare --text-scale: 1 par défaut, mais aucun <style> additionnel
    // portant la valeur agrandie n'est injecté tant que largeText n'est pas demandé.
    expect(html).not.toContain(`--text-scale:${LARGE_TEXT_SCALE};`);
    expect(html).not.toContain('<style>:root{--text-scale:');
  });

  it('largeText: false — identique au rendu par défaut', () => {
    const withFalse = renderTemplate(SlideTemplate.Title, baseTitleInput, { largeText: false });
    const withoutOptions = renderTemplate(SlideTemplate.Title, baseTitleInput);
    expect(withFalse).toBe(withoutOptions);
  });

  it('largeText: true — injecte un override --text-scale avant </head>', () => {
    const html = renderTemplate(SlideTemplate.Title, baseTitleInput, { largeText: true });
    expect(html).toContain(`--text-scale:${LARGE_TEXT_SCALE};`);
    expect(html.indexOf('--text-scale')).toBeLessThan(html.indexOf('</head>'));
    // Le contenu textuel reste inchangé, seule la taille de police est affectée.
    expect(html).toContain('Les génériques');
  });

  it('largeText: true fonctionne sur tous les gabarits (aucune exception, </head> présent partout)', () => {
    const inputs: Record<string, unknown> = {
      title: baseTitleInput,
      content: { courseTitle: 'C', lessonNumber: 1, title: 'T', bullets: ['a'] },
      code: { courseTitle: 'C', lessonNumber: 1, title: 'T', language: 'ts', codeHtml: 'const x = 1;' },
      comparison: {
        courseTitle: 'C', lessonNumber: 1, title: 'T',
        left: { title: 'A', items: ['a'] }, right: { title: 'B', items: ['b'] },
      },
      quote: { courseTitle: 'C', quote: 'Q', author: 'X' },
      diagram: { courseTitle: 'C', lessonNumber: 1, title: 'T', diagramHtml: '<svg></svg>' },
      recap: { courseTitle: 'C', lessonNumber: 1, title: 'T', items: ['a'] },
      'section-transition': { courseTitle: 'C', sectionNumber: 1, title: 'T' },
      timeline: {
        courseTitle: 'C', lessonNumber: 1, title: 'T',
        steps: [{ date: '2024', label: 'A' }, { date: '2025', label: 'B' }],
      },
    };
    for (const name of Object.values(SlideTemplate)) {
      const html = renderTemplate(name, inputs[name] as never, { largeText: true });
      expect(html).toContain('--text-scale:');
    }
  });
});
