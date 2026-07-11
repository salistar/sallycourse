import { describe, expect, it } from 'vitest';
import {
  buildTextSearchQuery,
  excerptAroundMatch,
  groupResultsByCourse,
  highlightMatches,
  sanitizeSearchQuery,
  validateSearchQuery,
} from './search';

// Tests de la recherche globale (P132) — logique PURE uniquement (construction
// de requête $text + surlignage), aucun accès MongoDB réel.

describe('sanitizeSearchQuery', () => {
  it('trim et collapse les espaces multiples', () => {
    expect(sanitizeSearchQuery('  react   avancé  ')).toBe('react avancé');
  });

  it('retire les guillemets doubles', () => {
    expect(sanitizeSearchQuery('"react" hooks')).toBe('react hooks');
  });
});

describe('validateSearchQuery', () => {
  it('rejette une requête trop courte', () => {
    const result = validateSearchQuery('a');
    expect(result.valid).toBe(false);
  });

  it('rejette une requête vide ou nulle', () => {
    expect(validateSearchQuery('').valid).toBe(false);
    expect(validateSearchQuery(null).valid).toBe(false);
    expect(validateSearchQuery(undefined).valid).toBe(false);
  });

  it('accepte une requête valide nettoyée', () => {
    const result = validateSearchQuery('  React  ');
    expect(result).toEqual({ valid: true, query: 'React' });
  });
});

describe('buildTextSearchQuery', () => {
  it('construit un filtre $text avec projection et tri par score', () => {
    const q = buildTextSearchQuery('react');
    expect(q.filter).toEqual({ $text: { $search: 'react' } });
    expect(q.projection).toEqual({ score: { $meta: 'textScore' } });
    expect(q.sort).toEqual({ score: { $meta: 'textScore' } });
    expect(q.limit).toBe(8);
  });

  it('fusionne les contraintes additionnelles (scope utilisateur)', () => {
    const q = buildTextSearchQuery('react', { courseId: { $in: ['a', 'b'] } }, 5);
    expect(q.filter).toEqual({ courseId: { $in: ['a', 'b'] }, $text: { $search: 'react' } });
    expect(q.limit).toBe(5);
  });
});

describe('highlightMatches', () => {
  it('retourne un seul segment non surligné si le terme est vide', () => {
    expect(highlightMatches('Introduction à React', '')).toEqual([
      { text: 'Introduction à React', match: false },
    ]);
  });

  it('surligne une occurrence unique au milieu du texte', () => {
    const segments = highlightMatches('Introduction à React avancé', 'React');
    expect(segments).toEqual([
      { text: 'Introduction à ', match: false },
      { text: 'React', match: true },
      { text: ' avancé', match: false },
    ]);
  });

  it('surligne plusieurs occurrences', () => {
    const segments = highlightMatches('test test test', 'test');
    expect(segments.filter((s) => s.match)).toHaveLength(3);
  });

  it('est insensible à la casse et aux accents', () => {
    const segments = highlightMatches('Cours de généralités', 'GENERALITES');
    expect(segments.some((s) => s.match && s.text === 'généralités')).toBe(true);
  });

  it('ne surligne rien si aucune occurrence', () => {
    const segments = highlightMatches('Introduction à Python', 'React');
    expect(segments).toEqual([{ text: 'Introduction à Python', match: false }]);
  });
});

describe('excerptAroundMatch', () => {
  it('retourne le début du texte si le terme est absent', () => {
    const text = 'a'.repeat(200);
    expect(excerptAroundMatch(text, 'zzz').length).toBeLessThanOrEqual(120);
  });

  it('centre un extrait autour du terme trouvé avec ellipses', () => {
    const text = `${'a'.repeat(100)} React ${'b'.repeat(100)}`;
    const excerpt = excerptAroundMatch(text, 'React', 10);
    expect(excerpt).toContain('React');
    expect(excerpt.startsWith('…')).toBe(true);
    expect(excerpt.endsWith('…')).toBe(true);
  });
});

describe('groupResultsByCourse', () => {
  it('regroupe les résultats par courseId et trie par score décroissant', () => {
    const groups = groupResultsByCourse([
      { kind: 'lesson', id: 'l1', title: 'Leçon 1', score: 0.5, href: '/x', courseId: 'c1', courseTitle: 'Cours A' },
      { kind: 'course', id: 'c1', title: 'Cours A', score: 1.2, href: '/y', courseId: 'c1', courseTitle: 'Cours A' },
      { kind: 'section', id: 's1', title: 'Section', score: 0.3, href: '/z', courseId: 'c2', courseTitle: 'Cours B' },
    ]);

    expect(groups).toHaveLength(2);
    const groupA = groups.find((g) => g.courseId === 'c1');
    expect(groupA?.items[0]?.id).toBe('c1');
    expect(groupA?.items).toHaveLength(2);
  });
});
