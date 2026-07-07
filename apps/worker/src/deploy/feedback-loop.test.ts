// Tests de la boucle de rétroaction qualité (P62) : mock des avis Udemy,
// analyse heuristique déterministe (thèmes + suggestions), moyenne des notes.
import { describe, expect, it } from 'vitest';
import {
  averageRating,
  fetchUdemyReviewsMock,
  mockReviewAnalysis,
  reviewAnalysisSchema,
  storedReviewAnalysisSchema,
  type StudentReview,
} from './feedback-loop.js';

describe('fetchUdemyReviewsMock', () => {
  it('renvoie un jeu déterministe d’avis pour un même titre de cours', () => {
    // createdAt dérive de Date.now() : on compare hors de ce champ, sensible au ms.
    const strip = (reviews: StudentReview[]) => reviews.map(({ createdAt: _createdAt, ...rest }) => rest);
    const a = fetchUdemyReviewsMock('Introduction à React');
    const b = fetchUdemyReviewsMock('Introduction à React');
    expect(strip(a)).toEqual(strip(b));
    expect(a.length).toBeGreaterThan(0);
  });

  it('varie selon le titre du cours (contenu différent)', () => {
    const a = fetchUdemyReviewsMock('Introduction à React');
    const b = fetchUdemyReviewsMock('Maîtriser Docker');
    expect(a).not.toEqual(b);
  });

  it('respecte le plafond de templates disponibles (count borné)', () => {
    const reviews = fetchUdemyReviewsMock('Cours X', 100);
    expect(reviews.length).toBeLessThanOrEqual(10);
  });

  it('chaque avis a une note entre 0 et 5 et un id unique', () => {
    const reviews = fetchUdemyReviewsMock('Cours Y');
    const ids = new Set(reviews.map((r) => r.id));
    expect(ids.size).toBe(reviews.length);
    for (const r of reviews) {
      expect(r.rating).toBeGreaterThanOrEqual(0);
      expect(r.rating).toBeLessThanOrEqual(5);
    }
  });
});

describe('averageRating', () => {
  it('renvoie 0 pour un tableau vide', () => {
    expect(averageRating([])).toBe(0);
  });

  it('calcule la moyenne arrondie au dixième', () => {
    const reviews: StudentReview[] = [
      { id: '1', rating: 5, comment: 'a' },
      { id: '2', rating: 4, comment: 'b' },
      { id: '3', rating: 3, comment: 'c' },
    ];
    expect(averageRating(reviews)).toBe(4);
  });

  it('gère les moyennes non entières', () => {
    const reviews: StudentReview[] = [
      { id: '1', rating: 5, comment: 'a' },
      { id: '2', rating: 2, comment: 'b' },
    ];
    expect(averageRating(reviews)).toBe(3.5);
  });
});

describe('mockReviewAnalysis (parsing reviews → thèmes + suggestions)', () => {
  it('produit un résultat conforme au schéma pour un lot d’avis mixtes', () => {
    const reviews: StudentReview[] = [
      { id: '1', rating: 5, comment: 'Excellent cours, très clair et progressif.' },
      { id: '2', rating: 2, comment: "Le rythme est bien trop rapide, je n'arrive pas à suivre." },
      { id: '3', rating: 3, comment: "L'audio est parfois faible et saccadé." },
    ];
    const analysis = mockReviewAnalysis(['Introduction', 'Installation de l’environnement'], reviews);
    expect(() => reviewAnalysisSchema.parse(analysis)).not.toThrow();
    expect(analysis.themes.length).toBeGreaterThan(0);
  });

  it('regroupe les avis positifs (note >= 4) dans un thème « appréciation générale »', () => {
    const reviews: StudentReview[] = [
      { id: '1', rating: 5, comment: 'Parfait pour débuter.' },
      { id: '2', rating: 4, comment: 'Formation solide.' },
    ];
    const analysis = mockReviewAnalysis([], reviews);
    const positive = analysis.themes.find((t) => t.label === 'Appréciation générale');
    expect(positive).toBeDefined();
    expect(positive?.sentiment).toBe('positive');
    expect(positive?.count).toBe(2);
  });

  it('détecte le thème « rythme des vidéos » et produit une suggestion actionnable', () => {
    const reviews: StudentReview[] = [
      { id: '1', rating: 2, comment: 'Le rythme est trop rapide, difficile à suivre.' },
      { id: '2', rating: 1, comment: 'Trop rapide, je me suis perdu.' },
    ];
    const analysis = mockReviewAnalysis([], reviews);
    const theme = analysis.themes.find((t) => t.label === 'Rythme des vidéos');
    expect(theme).toBeDefined();
    expect(theme?.sentiment).toBe('negative');

    const suggestion = analysis.suggestions.find((s) => s.action.toLowerCase().includes('ralentir'));
    expect(suggestion).toBeDefined();
    expect(suggestion?.lessonRef).toBeNull();
  });

  it('ne produit pas de suggestion pour un thème positif', () => {
    const reviews: StudentReview[] = [
      { id: '1', rating: 5, comment: 'Excellent cours, très clair.' },
      { id: '2', rating: 4, comment: 'Très bon contenu, clair du début à la fin.' },
    ];
    const analysis = mockReviewAnalysis([], reviews);
    const clarityTheme = analysis.themes.find((t) => t.label === 'Clarté et structure');
    if (clarityTheme && clarityTheme.sentiment === 'positive') {
      const relatedSuggestion = analysis.suggestions.find((s) => s.action.includes('Clarifier'));
      expect(relatedSuggestion).toBeUndefined();
    }
  });

  it('résout lessonRef vers une leçon dont le titre matche l’indice (installation)', () => {
    const reviews: StudentReview[] = [
      { id: '1', rating: 2, comment: "Le chapitre sur l'installation est confus, l'ordre n'est pas bon." },
    ];
    const analysis = mockReviewAnalysis(['Introduction', 'Installation de l’environnement'], reviews);
    const suggestion = analysis.suggestions.find((s) => s.action.toLowerCase().includes('clarifier'));
    expect(suggestion?.lessonRef).toBe('Installation de l’environnement');
  });

  it('renvoie themes et suggestions vides pour un lot d’avis vide', () => {
    const analysis = mockReviewAnalysis([], []);
    expect(analysis.themes).toEqual([]);
    expect(analysis.suggestions).toEqual([]);
  });
});

describe('storedReviewAnalysisSchema', () => {
  it('valide une analyse persistée avec ses métadonnées', () => {
    const stored = {
      themes: [],
      suggestions: [],
      reviewCount: 8,
      averageRating: 3.4,
      generatedAt: new Date().toISOString(),
    };
    expect(() => storedReviewAnalysisSchema.parse(stored)).not.toThrow();
  });

  it('rejette une averageRating hors bornes [0,5]', () => {
    const stored = {
      themes: [],
      suggestions: [],
      reviewCount: 8,
      averageRating: 6,
      generatedAt: new Date().toISOString(),
    };
    expect(() => storedReviewAnalysisSchema.parse(stored)).toThrow();
  });
});
