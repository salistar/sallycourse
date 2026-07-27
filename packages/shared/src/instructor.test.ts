import { describe, expect, it } from 'vitest';
import {
  aggregateInstructorStats,
  aggregateReviews,
  instructorBioSchema,
  instructorCoursesJsonLd,
  instructorPath,
  instructorPersonJsonLd,
  isReservedHandle,
  parseHandleParam,
  reviewerDisplayName,
  suggestHandle,
  validateHandle,
  type InstructorJsonLdInput,
} from './instructor';

describe('validateHandle', () => {
  it('accepte un handle bien formé', () => {
    expect(validateHandle('jean-dupont')).toEqual({ valid: true });
    expect(validateHandle('sally_42')).toEqual({ valid: true });
    expect(validateHandle('abc')).toEqual({ valid: true });
  });

  it('normalise la casse et les espaces autour', () => {
    expect(validateHandle('  Jean-Dupont  ')).toEqual({ valid: true });
  });

  it('refuse un format invalide (trop court, trop long, caractères interdits)', () => {
    expect(validateHandle('ab')).toEqual({ valid: false, error: 'format' });
    expect(validateHandle('a'.repeat(31))).toEqual({ valid: false, error: 'format' });
    expect(validateHandle('jean dupont')).toEqual({ valid: false, error: 'format' });
    expect(validateHandle('jean.dupont')).toEqual({ valid: false, error: 'format' });
    expect(validateHandle('@jean')).toEqual({ valid: false, error: 'format' });
    expect(validateHandle('jéan')).toEqual({ valid: false, error: 'format' });
  });

  it('refuse les handles réservés (collision avec les routes racine)', () => {
    for (const reserved of ['dashboard', 'blog', 'api', 'learn', 'pricing', 'settings']) {
      expect(validateHandle(reserved)).toEqual({ valid: false, error: 'reserved' });
      expect(isReservedHandle(reserved.toUpperCase())).toBe(true);
    }
  });
});

describe('parseHandleParam', () => {
  it('extrait le handle d’un segment « @handle »', () => {
    expect(parseHandleParam('@jean-dupont')).toBe('jean-dupont');
    expect(parseHandleParam('@Jean-Dupont')).toBe('jean-dupont');
  });

  it('rejette un segment sans « @ » ou mal formé (→ 404 côté page)', () => {
    expect(parseHandleParam('jean-dupont')).toBeNull();
    expect(parseHandleParam('@ab')).toBeNull();
    expect(parseHandleParam('@jean dupont')).toBeNull();
    expect(parseHandleParam('@@jean')).toBeNull();
    expect(parseHandleParam('')).toBeNull();
  });

  it('rejette un segment visant un handle réservé', () => {
    expect(parseHandleParam('@dashboard')).toBeNull();
  });

  it('instructorPath est l’inverse de parseHandleParam', () => {
    expect(instructorPath('jean-dupont')).toBe('/@jean-dupont');
    expect(parseHandleParam(instructorPath('jean-dupont').slice(1))).toBe('jean-dupont');
  });
});

describe('suggestHandle', () => {
  it('translittère et slugifie le nom', () => {
    expect(suggestHandle('Jean Dupont')).toBe('jean-dupont');
    expect(suggestHandle('Amélie Poulain')).toBe('amelie-poulain');
    expect(suggestHandle('François Œuvre')).toBe('francois-oeuvre');
  });

  it('tronque à 30 caractères sans tiret final', () => {
    const suggestion = suggestHandle('Jean Baptiste Emmanuel Zorg de la Montagne');
    expect(suggestion.length).toBeLessThanOrEqual(30);
    expect(suggestion.endsWith('-')).toBe(false);
    expect(validateHandle(suggestion)).toEqual({ valid: true });
  });

  it('retombe sur la graine si le nom ne produit rien d’exploitable', () => {
    const arabic = suggestHandle('محمد', '65f1a2b3c4d5e6f708192a3b');
    expect(arabic).toBe('instructeur-192a3b');
    expect(validateHandle(arabic)).toEqual({ valid: true });
  });

  it('complète un nom trop court ou réservé (jamais de handle invalide)', () => {
    expect(suggestHandle('Al', 'abc123')).toBe('al-abc123');
    expect(suggestHandle('Blog', 'abc123')).toBe('blog-abc123');
    expect(validateHandle(suggestHandle('Blog', 'abc123'))).toEqual({ valid: true });
  });

  it('est déterministe', () => {
    expect(suggestHandle('Jean Dupont', 'seed')).toBe(suggestHandle('Jean Dupont', 'seed'));
  });
});

describe('instructorBioSchema', () => {
  it('valide une bio conforme', () => {
    const parsed = instructorBioSchema.safeParse({
      headline: 'Ingénieur QA, 12 ans de terrain',
      bio: 'x'.repeat(120),
      expertise: ['Test logiciel', 'Automatisation'],
    });
    expect(parsed.success).toBe(true);
  });

  it('refuse une bio trop courte ou sans expertise suffisante', () => {
    expect(
      instructorBioSchema.safeParse({ headline: 'A', bio: 'trop court', expertise: ['a', 'b'] })
        .success,
    ).toBe(false);
    expect(
      instructorBioSchema.safeParse({ headline: 'A', bio: 'x'.repeat(120), expertise: ['a'] })
        .success,
    ).toBe(false);
  });
});

describe('aggregateInstructorStats', () => {
  it('agrège leçons, durée, inscrits et plateformes distinctes', () => {
    const stats = aggregateInstructorStats([
      { courseId: 'a', lessonCount: 10, durationMin: 90, platforms: ['udemy'], studentCount: 5 },
      {
        courseId: 'b',
        lessonCount: 6,
        durationMin: 45,
        platforms: ['udemy', 'youtube'],
        studentCount: 2,
      },
    ]);
    expect(stats).toEqual({
      courseCount: 2,
      lessonCount: 16,
      totalDurationMin: 135,
      totalHours: 2.3,
      studentCount: 7,
      platforms: ['udemy', 'youtube'],
    });
  });

  it('catalogue vide → tout à zéro', () => {
    expect(aggregateInstructorStats([])).toEqual({
      courseCount: 0,
      lessonCount: 0,
      totalDurationMin: 0,
      totalHours: 0,
      studentCount: 0,
      platforms: [],
    });
  });
});

describe('aggregateReviews', () => {
  it('retourne null sans aucun avis (section masquée — jamais d’avis simulés)', () => {
    expect(aggregateReviews([])).toBeNull();
  });

  it('calcule moyenne, total et distribution', () => {
    const aggregate = aggregateReviews([
      { rating: 5 },
      { rating: 4 },
      { rating: 5 },
      { rating: 3, comment: 'correct' },
    ]);
    expect(aggregate).toEqual({
      count: 4,
      average: 4.3,
      distribution: { 1: 0, 2: 0, 3: 1, 4: 1, 5: 2 },
    });
  });

  it('ignore les notes hors bornes', () => {
    expect(aggregateReviews([{ rating: 0 }, { rating: 6 }, { rating: 4 }])).toEqual({
      count: 1,
      average: 4,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 0 },
    });
    expect(aggregateReviews([{ rating: 0 }, { rating: 9 }])).toBeNull();
  });
});

describe('reviewerDisplayName', () => {
  it('réduit au prénom + initiale', () => {
    expect(reviewerDisplayName('Jean Dupont', 'Apprenant')).toBe('Jean D.');
    expect(reviewerDisplayName('  Marie  Claire  Martin ', 'Apprenant')).toBe('Marie M.');
  });

  it('nom seul ou vide', () => {
    expect(reviewerDisplayName('Jean', 'Apprenant')).toBe('Jean');
    expect(reviewerDisplayName('   ', 'Apprenant')).toBe('Apprenant');
  });
});

describe('JSON-LD', () => {
  const base: InstructorJsonLdInput = {
    name: 'Jean Dupont',
    handle: 'jean-dupont',
    headline: 'Ingénieur QA',
    bio: 'Bio de Jean.',
    expertise: ['QA', 'Automatisation'],
    siteUrl: 'https://sallycourse.com/',
    courses: [
      { title: 'Robot Framework', summary: 'Automatiser ses tests', url: 'https://s/learn/1' },
    ],
    reviews: { count: 3, average: 4.7, distribution: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 2 } },
  };

  it('Person porte l’URL canonique et la note agrégée', () => {
    const person = instructorPersonJsonLd(base);
    expect(person['@type']).toBe('Person');
    expect(person.url).toBe('https://sallycourse.com/@jean-dupont');
    expect(person.aggregateRating).toEqual({
      '@type': 'AggregateRating',
      ratingValue: 4.7,
      reviewCount: 3,
      bestRating: 5,
      worstRating: 1,
    });
  });

  it('Person sans avis réels n’expose AUCUNE note agrégée', () => {
    const person = instructorPersonJsonLd({ ...base, reviews: null });
    expect(person.aggregateRating).toBeUndefined();
  });

  it('ItemList liste les cours publiés, null si catalogue vide', () => {
    const list = instructorCoursesJsonLd(base) as Record<string, unknown>;
    expect(list.numberOfItems).toBe(1);
    expect(instructorCoursesJsonLd({ ...base, courses: [] })).toBeNull();
  });
});
