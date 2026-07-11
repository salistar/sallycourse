// Tests purs des ajouts Prompt 83 : détection du type de contenu enrichi
// d'une slide et parseur Mermaid minimal (repli sans la lib `mermaid`).
import { describe, expect, it } from 'vitest';
import {
  detectSlideContentType,
  isLikelyMermaidSource,
  parseMermaidFlowchart,
  slideSchema,
  type Slide,
} from './lesson-content';

function baseSlide(partial: Partial<Slide>): Slide {
  return {
    template: 'diagram',
    title: 'Titre',
    bullets: [],
    narration: 'narration',
    ...partial,
  };
}

describe('detectSlideContentType', () => {
  it('retourne null sans aucun signal (repli liste à puces)', () => {
    expect(detectSlideContentType(baseSlide({ bullets: ['a', 'b'] }))).toBeNull();
  });

  it('détecte "diagram" via le champ structuré mermaid', () => {
    const slide = baseSlide({ mermaid: { source: 'flowchart TD\nA-->B' } });
    expect(detectSlideContentType(slide)).toBe('diagram');
  });

  it('détecte "comparisonTable" via le champ structuré', () => {
    const slide = baseSlide({
      comparisonTable: {
        columns: ['REST', 'GraphQL'],
        rows: [{ label: 'Requêtes', values: ['multiples', 'une seule'] }],
      },
    });
    expect(detectSlideContentType(slide)).toBe('comparisonTable');
  });

  it('détecte "timeline" via le champ structuré', () => {
    const slide = baseSlide({
      timeline: {
        steps: [
          { date: '2023', label: 'Début' },
          { date: '2024', label: 'Lancement' },
        ],
      },
    });
    expect(detectSlideContentType(slide)).toBe('timeline');
  });

  it('priorité mermaid > comparisonTable > timeline si plusieurs champs présents', () => {
    const slide = baseSlide({
      mermaid: { source: 'flowchart TD\nA-->B' },
      timeline: { steps: [{ date: '2023', label: 'a' }, { date: '2024', label: 'b' }] },
    });
    expect(detectSlideContentType(slide)).toBe('diagram');
  });

  it('repli texte : reconnaît un bloc mermaid dans les notes', () => {
    const slide = baseSlide({ notes: 'flowchart LR\nStart --> End' });
    expect(detectSlideContentType(slide)).toBe('diagram');
  });

  it('repli texte : reconnaît une frise via des bullets datées', () => {
    const slide = baseSlide({
      bullets: ['2020 — Création', '2022 : Levée de fonds', 'Sans date'],
    });
    expect(detectSlideContentType(slide)).toBe('timeline');
  });

  it('repli texte : une seule bullet datée ne suffit pas (< 2)', () => {
    const slide = baseSlide({ bullets: ['2020 — Création', 'Sans date du tout'] });
    expect(detectSlideContentType(slide)).toBeNull();
  });
});

describe('isLikelyMermaidSource', () => {
  it('reconnaît un en-tête flowchart avec arête', () => {
    expect(isLikelyMermaidSource('flowchart TD\nA --> B')).toBe(true);
  });
  it('reconnaît un en-tête graph LR', () => {
    expect(isLikelyMermaidSource('graph LR\nA --> B --> C')).toBe(true);
  });
  it('rejette un texte sans en-tête reconnu', () => {
    expect(isLikelyMermaidSource('Ceci est juste du texte normal.')).toBe(false);
  });
  it('rejette une chaîne vide', () => {
    expect(isLikelyMermaidSource('   ')).toBe(false);
  });
  it('rejette un en-tête sans arête', () => {
    expect(isLikelyMermaidSource('flowchart TD\nA')).toBe(false);
  });
});

describe('parseMermaidFlowchart', () => {
  it('parse un lien simple A --> B', () => {
    const graph = parseMermaidFlowchart('flowchart TD\nA --> B');
    expect(graph.nodes.map((n) => n.id)).toEqual(['A', 'B']);
    expect(graph.edges).toEqual([{ from: 'A', to: 'B' }]);
  });

  it('extrait les libellés de nœuds entre crochets', () => {
    const graph = parseMermaidFlowchart('flowchart TD\nA[Début] --> B[Fin]');
    expect(graph.nodes.find((n) => n.id === 'A')?.label).toBe('Début');
    expect(graph.nodes.find((n) => n.id === 'B')?.label).toBe('Fin');
  });

  it('extrait le libellé porté par la flèche', () => {
    const graph = parseMermaidFlowchart('flowchart TD\nA -->|oui| B');
    expect(graph.edges[0]?.label).toBe('oui');
  });

  it('construit une chaîne de plusieurs nœuds sans doublons', () => {
    const graph = parseMermaidFlowchart('flowchart TD\nA --> B\nB --> C\nA --> C');
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(3);
  });

  it('ignore les lignes non reconnues (commentaires, styles) sans jeter', () => {
    const graph = parseMermaidFlowchart('flowchart TD\n%% commentaire\nclassDef foo fill:#fff\nA --> B');
    expect(graph.edges).toHaveLength(1);
  });

  it('retourne un graphe vide pour une source sans lien', () => {
    const graph = parseMermaidFlowchart('flowchart TD\n');
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });
});

describe('slideSchema — champs additifs P83', () => {
  it('reste valide sans aucun des nouveaux champs (rétro-compatibilité)', () => {
    const parsed = slideSchema.safeParse(baseSlide({ template: 'content', bullets: ['a'] }));
    expect(parsed.success).toBe(true);
  });

  it('valide un mermaid + comparisonTable + timeline + codeHighlightSteps combinés', () => {
    const parsed = slideSchema.safeParse(
      baseSlide({
        mermaid: { source: 'flowchart TD\nA-->B' },
        comparisonTable: {
          columns: ['A', 'B'],
          rows: [{ label: 'x', values: ['1', '2'] }],
        },
        timeline: { steps: [{ date: '2024', label: 'x' }, { date: '2025', label: 'y' }] },
        codeHighlightSteps: [{ lines: [0, 1] }],
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it('rejette un comparisonTable avec plus de 4 colonnes', () => {
    const parsed = slideSchema.safeParse(
      baseSlide({
        comparisonTable: {
          columns: ['A', 'B', 'C', 'D', 'E'],
          rows: [{ label: 'x', values: ['1', '2', '3', '4', '5'] }],
        },
      }),
    );
    expect(parsed.success).toBe(false);
  });

  it('rejette une timeline avec une seule étape', () => {
    const parsed = slideSchema.safeParse(
      baseSlide({ timeline: { steps: [{ date: '2024', label: 'x' }] } }),
    );
    expect(parsed.success).toBe(false);
  });
});
