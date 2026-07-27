/**
 * Tests unitaires — render-templates.ts : rendu de base + option largeText
 * (Prompt 137, accessibilité). Fonction pure et déterministe.
 */
import { describe, expect, it } from 'vitest';
import {
  contentFitScale,
  LARGE_TEXT_SCALE,
  renderTemplate,
  SlideTemplate,
  titleFontScale,
} from './render-templates';

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

describe('titleFontScale (correctif 1.5, audit 2026-07-20 — titre tronqué)', () => {
  it('ne réduit pas un titre court', () => {
    expect(titleFontScale('Les génériques')).toBe(1);
  });

  it('réduit un titre long (cas réel : « La Due Diligence Environnementale », 34 caractères)', () => {
    expect(titleFontScale('La Due Diligence Environnementale')).toBeLessThan(1);
  });

  it('réduit davantage un titre plus long qu’un titre moyennement long', () => {
    const medium = titleFontScale('Un titre de longueur moyenne ici');
    const long = titleFontScale(
      'Un titre vraiment très long qui dépasserait largement le cadre disponible pour le texte',
    );
    expect(long).toBeLessThan(medium);
  });
});

describe('contentFitScale (correctif 2026-07-26 — puces tronquées)', () => {
  const short = ['Point un', 'Point deux', 'Point trois'];

  it('ne réduit pas des puces courtes et peu nombreuses', () => {
    expect(contentFitScale('Un titre', short, false)).toBe(1);
  });

  it('réduit quand les puces sont nombreuses et longues (déborderait 1080px)', () => {
    const dense = Array.from({ length: 5 }, (_, i) =>
      `Puce ${i + 1} : une explication détaillée qui occupe facilement deux lignes complètes à l’écran dans le cadre du gabarit`,
    );
    expect(contentFitScale('Un titre de leçon assez long lui aussi', dense, false)).toBeLessThan(1);
  });

  it('ne descend jamais sous 0.6 (plancher de lisibilité)', () => {
    const huge = Array.from({ length: 6 }, () =>
      'Une puce vraiment très longue '.repeat(8),
    );
    expect(contentFitScale('Titre', huge, false)).toBeGreaterThanOrEqual(0.6);
  });

  it('réduit plus tôt quand une illustration occupe la droite (largeur utile moindre)', () => {
    const medium = Array.from({ length: 4 }, () =>
      'Une puce de longueur moyenne qui tient sur une seule ligne sans illustration',
    );
    expect(contentFitScale('Titre', medium, true)).toBeLessThanOrEqual(
      contentFitScale('Titre', medium, false),
    );
  });

  it('renvoie 1 sans puce', () => {
    expect(contentFitScale('Titre', [], false)).toBe(1);
  });
});

describe('renderTemplate(content) — auto-fit des puces', () => {
  const baseContentInput = {
    lang: 'fr',
    direction: 'ltr' as const,
    courseTitle: 'Cours',
    progress: 40,
    lessonLabel: 'Leçon',
    lessonNumber: 3,
    title: 'Un titre',
    bullets: ['A', 'B', 'C'],
    illustrationDataUri: '',
  };

  it('injecte --fit:1 pour un contenu léger et ne laisse aucun placeholder brut', () => {
    const html = renderTemplate(SlideTemplate.Content, baseContentInput);
    expect(html).not.toMatch(/\{\{fitScale\}\}/);
    expect(html).toContain('--fit: 1;');
  });

  it('injecte un --fit réduit pour un contenu dense', () => {
    const dense = Array.from({ length: 5 }, (_, i) =>
      `Puce ${i + 1} : une explication détaillée qui occupe facilement deux lignes complètes à l’écran`,
    );
    const html = renderTemplate(SlideTemplate.Content, { ...baseContentInput, bullets: dense });
    const expected = contentFitScale(baseContentInput.title, dense, false);
    expect(expected).toBeLessThan(1);
    expect(html).toContain(`--fit: ${expected};`);
  });
});

describe('renderTemplate(title) — auto-fit du titre (correctif 1.5)', () => {
  it('injecte --title-scale:1 pour un titre court', () => {
    const html = renderTemplate(SlideTemplate.Title, baseTitleInput);
    expect(html).toContain('--title-scale: 1;');
  });

  it('injecte un --title-scale réduit pour un titre long, sans jamais laisser le placeholder brut', () => {
    const html = renderTemplate(SlideTemplate.Title, {
      ...baseTitleInput,
      title: 'La Due Diligence Environnementale',
    });
    expect(html).not.toMatch(/\{\{titleScale\}\}/);
    expect(html).toContain(`--title-scale: ${titleFontScale('La Due Diligence Environnementale')};`);
  });
});

describe('image par slide — gabarits content/recap (Lot 3, plan 2026-07-20)', () => {
  const DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
  const baseContentInput = {
    courseTitle: 'Maîtriser TypeScript',
    lessonNumber: 4,
    title: 'Les génériques',
    bullets: ['Point un', 'Point deux'],
  };
  const baseRecapInput = {
    courseTitle: 'Maîtriser TypeScript',
    lessonNumber: 4,
    title: 'À retenir',
    items: ['Point un', 'Point deux'],
  };

  it('content : sans illustrationDataUri, aucun panneau .illustration', () => {
    const html = renderTemplate(SlideTemplate.Content, baseContentInput);
    expect(html).not.toContain('class="illustration"');
    expect(html).not.toMatch(/\{\{illustrationHtml\}\}/);
  });

  it('content : avec illustrationDataUri, injecte le panneau image', () => {
    const html = renderTemplate(SlideTemplate.Content, { ...baseContentInput, illustrationDataUri: DATA_URI });
    expect(html).toContain('class="illustration"');
    expect(html).toContain(`src="${DATA_URI}"`);
  });

  it('content : une valeur qui n’est pas un data URI image est ignorée (jamais d’URL réseau)', () => {
    const html = renderTemplate(SlideTemplate.Content, {
      ...baseContentInput,
      illustrationDataUri: 'https://exemple.org/x.png',
    });
    expect(html).not.toContain('class="illustration"');
    expect(html).not.toContain('exemple.org');
  });

  it('recap : sans illustrationDataUri, aucun panneau .illustration', () => {
    const html = renderTemplate(SlideTemplate.Recap, baseRecapInput);
    expect(html).not.toContain('class="illustration"');
  });

  it('recap : avec illustrationDataUri, injecte le panneau image', () => {
    const html = renderTemplate(SlideTemplate.Recap, { ...baseRecapInput, illustrationDataUri: DATA_URI });
    expect(html).toContain('class="illustration"');
    expect(html).toContain(`src="${DATA_URI}"`);
  });
});
