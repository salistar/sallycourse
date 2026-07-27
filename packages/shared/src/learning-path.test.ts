// Tests purs (P199) : progression dérivée d'un parcours, verrous de prérequis
// en chaîne, économie du prix bundle, slug et schéma de page de vente. Aucune I/O.
import { describe, expect, it } from 'vitest';
import {
  LEARNING_PATH_MAX_COURSES,
  bundleSavings,
  completedCourseIds,
  computePathProgress,
  learningPathSalesPageSchema,
  resolveUnlockedCourses,
  slugifyPathTitle,
  type PathCourseRef,
} from './learning-path';

/** Trois cours chaînés : le 2e et le 3e exigent la complétion du précédent. */
const CHAIN: PathCourseRef[] = [
  { courseId: 'c1', order: 0, requiresPrevious: false },
  { courseId: 'c2', order: 1, requiresPrevious: true },
  { courseId: 'c3', order: 2, requiresPrevious: true },
];

describe('computePathProgress', () => {
  it('un parcours sans cours vaut 0 % et n’est jamais « terminé »', () => {
    expect(computePathProgress([], [])).toEqual({
      completedCourses: 0,
      totalCourses: 0,
      percent: 0,
      completed: false,
    });
  });

  it('ne compte que les inscriptions dont completedAt est renseignée', () => {
    const progress = computePathProgress(CHAIN, [
      { courseId: 'c1', completedAt: new Date('2026-01-01') },
      { courseId: 'c2', completedAt: null },
    ]);
    expect(progress).toEqual({
      completedCourses: 1,
      totalCourses: 3,
      percent: 33,
      completed: false,
    });
  });

  it('ignore les inscriptions à des cours hors du parcours', () => {
    const progress = computePathProgress(CHAIN, [
      { courseId: 'autre-cours', completedAt: new Date() },
    ]);
    expect(progress.completedCourses).toBe(0);
    expect(progress.percent).toBe(0);
  });

  it('parcours entièrement terminé → 100 % et completed=true', () => {
    const now = new Date();
    const progress = computePathProgress(CHAIN, [
      { courseId: 'c1', completedAt: now },
      { courseId: 'c2', completedAt: now },
      { courseId: 'c3', completedAt: now },
    ]);
    expect(progress).toEqual({
      completedCourses: 3,
      totalCourses: 3,
      percent: 100,
      completed: true,
    });
  });

  it('un cours listé deux fois n’est compté qu’une fois', () => {
    const duplicated: PathCourseRef[] = [
      { courseId: 'c1', order: 0, requiresPrevious: false },
      { courseId: 'c1', order: 1, requiresPrevious: false },
    ];
    const progress = computePathProgress(duplicated, [{ courseId: 'c1', completedAt: new Date() }]);
    expect(progress).toEqual({
      completedCourses: 1,
      totalCourses: 1,
      percent: 100,
      completed: true,
    });
  });
});

describe('completedCourseIds', () => {
  it('retient uniquement les cours réellement terminés', () => {
    const ids = completedCourseIds([
      { courseId: 'a', completedAt: '2026-02-01T00:00:00.000Z' },
      { courseId: 'b' },
      { courseId: 'c', completedAt: null },
    ]);
    expect([...ids]).toEqual(['a']);
  });
});

describe('resolveUnlockedCourses', () => {
  it('déverrouille le premier cours même s’il exige un prérequis (aucun précédent)', () => {
    const resolved = resolveUnlockedCourses(
      [{ courseId: 'c1', order: 0, requiresPrevious: true }],
      [],
    );
    expect(resolved[0]!.unlocked).toBe(true);
  });

  it('verrouille toute la chaîne tant que rien n’est terminé', () => {
    const resolved = resolveUnlockedCourses(CHAIN, []);
    expect(resolved.map((c) => c.unlocked)).toEqual([true, false, false]);
  });

  it('terminer le 1er déverrouille le 2e, mais pas le 3e', () => {
    const resolved = resolveUnlockedCourses(CHAIN, ['c1']);
    expect(resolved.map((c) => c.unlocked)).toEqual([true, true, false]);
    expect(resolved.map((c) => c.completed)).toEqual([true, false, false]);
  });

  it('verrou TRANSITIF : terminer le 2e hors chaîne ne déverrouille pas le 3e si le 1er manque', () => {
    // c2 complété (acheté séparément), c1 jamais terminé : la chaîne est cassée
    // au 1er maillon, donc c3 doit rester verrouillé malgré un c2 « completed ».
    const resolved = resolveUnlockedCourses(CHAIN, ['c2']);
    expect(resolved.map((c) => c.unlocked)).toEqual([true, false, false]);
    expect(resolved.map((c) => c.completed)).toEqual([false, true, false]);
  });

  it('un cours sans prérequis reste accessible même si le précédent est inachevé', () => {
    const mixed: PathCourseRef[] = [
      { courseId: 'c1', order: 0, requiresPrevious: false },
      { courseId: 'c2', order: 1, requiresPrevious: false },
    ];
    expect(resolveUnlockedCourses(mixed, []).map((c) => c.unlocked)).toEqual([true, true]);
  });

  it('résout dans l’ordre déclaré, pas dans l’ordre du tableau', () => {
    const shuffled: PathCourseRef[] = [
      { courseId: 'c3', order: 2, requiresPrevious: true },
      { courseId: 'c1', order: 0, requiresPrevious: false },
      { courseId: 'c2', order: 1, requiresPrevious: true },
    ];
    const resolved = resolveUnlockedCourses(shuffled, ['c1', 'c2']);
    expect(resolved.map((c) => c.courseId)).toEqual(['c1', 'c2', 'c3']);
    expect(resolved.map((c) => c.unlocked)).toEqual([true, true, true]);
  });
});

describe('bundleSavings', () => {
  it('calcule l’économie et son pourcentage', () => {
    expect(bundleSavings([10000, 5000, 5000], 15000)).toEqual({
      coursesTotalCents: 20000,
      bundlePriceCents: 15000,
      savingsCents: 5000,
      savingsPercent: 25,
    });
  });

  it('un bundle plus cher que la somme des cours ne produit jamais d’économie négative', () => {
    const result = bundleSavings([1000], 3000);
    expect(result.savingsCents).toBe(0);
    expect(result.savingsPercent).toBe(0);
  });

  it('parcours entièrement gratuit → tout à zéro (aucune division par zéro)', () => {
    expect(bundleSavings([0, 0], 0)).toEqual({
      coursesTotalCents: 0,
      bundlePriceCents: 0,
      savingsCents: 0,
      savingsPercent: 0,
    });
  });

  it('bundle gratuit sur des cours payants → 100 % d’économie', () => {
    const result = bundleSavings([2500, 2500], 0);
    expect(result.savingsCents).toBe(5000);
    expect(result.savingsPercent).toBe(100);
  });

  it('ignore les prix invalides (négatifs, NaN)', () => {
    const result = bundleSavings([-500, Number.NaN, 1000], -100);
    expect(result.coursesTotalCents).toBe(1000);
    expect(result.bundlePriceCents).toBe(0);
    expect(result.savingsCents).toBe(1000);
  });
});

describe('slugifyPathTitle', () => {
  it('retire les accents et normalise les séparateurs', () => {
    expect(slugifyPathTitle('Devenir Développeur Full-Stack !')).toBe('devenir-developpeur-full-stack');
  });

  it('renvoie une chaîne vide si le titre n’a aucun caractère exploitable', () => {
    expect(slugifyPathTitle('??? !!!')).toBe('');
  });

  it('ne laisse jamais de tiret en fin de slug après troncature', () => {
    // Le séparateur tombe exactement à l'indice de coupe (80) : sans le
    // .replace(/-+$/g,'') APRÈS le slice, le slug se terminerait par « - ».
    const slug = slugifyPathTitle('a'.repeat(79) + ' b');
    expect(slug).toBe('a'.repeat(79));
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('learningPathSalesPageSchema', () => {
  const valid = {
    headline: 'Devenez développeur full-stack',
    subheadline: 'Trois cours, un parcours, un métier.',
    outcomes: ['Créer une API', 'Construire une UI', 'Déployer en production'],
    audience: ['Débutants motivés', 'Développeurs front qui veulent le back'],
    courseTeasers: [{ courseTitle: 'Bases du web', pitch: 'On pose les fondations.' }],
    faq: [
      { question: 'Combien de temps ?', answer: 'Environ 30 heures.' },
      { question: 'Certificat ?', answer: 'Oui, à la fin du parcours.' },
    ],
    ctaLabel: 'Rejoindre le parcours',
  };

  it('accepte une page de vente complète', () => {
    expect(learningPathSalesPageSchema.safeParse(valid).success).toBe(true);
  });

  it('rejette moins de 3 bénéfices ou moins de 2 questions de FAQ', () => {
    expect(learningPathSalesPageSchema.safeParse({ ...valid, outcomes: ['Un seul'] }).success).toBe(false);
    expect(
      learningPathSalesPageSchema.safeParse({ ...valid, faq: [valid.faq[0]] }).success,
    ).toBe(false);
  });

  it('borne le nombre de teasers au nombre max de cours d’un parcours', () => {
    const tooMany = Array.from({ length: LEARNING_PATH_MAX_COURSES + 1 }, (_, i) => ({
      courseTitle: `Cours ${i}`,
      pitch: 'Pitch.',
    }));
    expect(learningPathSalesPageSchema.safeParse({ ...valid, courseTeasers: tooMany }).success).toBe(
      false,
    );
  });
});
