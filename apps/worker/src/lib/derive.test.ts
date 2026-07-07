// Tests de la logique PURE de dérivation d'un cours (P64) : plan de dérivation
// (langue/niveau), fidélité structurelle d'un outline traduit, titre dérivé.
import { describe, expect, it } from 'vitest';
import { outlineSchema, type Outline } from '../shared.js';
import {
  derivedCourseTitle,
  planDerivation,
  translatedOutlineSchema,
  translateOutlineUserPrompt,
  validateTranslationStructure,
  type DerivationSpec,
} from './derive.js';

/** Outline minimal valide (1 section, 1 vidéo + 1 quiz) pour les tests. */
function makeOutline(overrides: Partial<Outline> = {}): Outline {
  const base: Outline = {
    title: 'Titre du cours',
    subtitle: 'Sous-titre orienté bénéfices',
    description: 'Description du cours suffisamment longue pour être crédible.',
    learningObjectives: ['Objectif 1', 'Objectif 2', 'Objectif 3', 'Objectif 4'],
    prerequisites: ['Aucun prérequis'],
    targetAudience: ['Débutants'],
    sections: [
      {
        title: 'Section 1',
        lessons: [
          { title: 'Intro', type: 'video', durationMin: 6, summary: 'Résumé vidéo.' },
          { title: 'Quiz', type: 'quiz', durationMin: 5, summary: 'Résumé quiz.' },
        ],
      },
    ],
  };
  return outlineSchema.parse({ ...base, ...overrides });
}

describe('planDerivation', () => {
  it('refuse une déclinaison sans changement de langue ni de niveau', () => {
    const plan = planDerivation({ sourceLocale: 'fr', sourceDifficulty: 'beginner' });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toBe('no_change');
  });

  it('active la traduction quand la langue change', () => {
    const plan = planDerivation({
      sourceLocale: 'fr',
      sourceDifficulty: 'beginner',
      targetLocale: 'en',
    });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.spec.translate).toBe(true);
      expect(plan.spec.targetLocale).toBe('en');
      expect(plan.spec.targetDifficulty).toBe('beginner');
    }
  });

  it('n’active pas la traduction pour un simple changement de niveau', () => {
    const plan = planDerivation({
      sourceLocale: 'fr',
      sourceDifficulty: 'beginner',
      targetDifficulty: 'advanced',
    });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.spec.translate).toBe(false);
      expect(plan.spec.targetLocale).toBe('fr');
      expect(plan.spec.targetDifficulty).toBe('advanced');
    }
  });

  it('gère le changement simultané de langue ET de niveau', () => {
    const plan = planDerivation({
      sourceLocale: 'fr',
      sourceDifficulty: 'beginner',
      targetLocale: 'ar',
      targetDifficulty: 'intermediate',
    });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.spec.translate).toBe(true);
      expect(plan.spec.targetLocale).toBe('ar');
      expect(plan.spec.targetDifficulty).toBe('intermediate');
    }
  });
});

describe('validateTranslationStructure', () => {
  const original = makeOutline();

  it('accepte une traduction fidèle (texte changé, structure identique)', () => {
    const translated = makeOutline({
      title: 'Course title',
      subtitle: 'Benefit-oriented subtitle',
      sections: [
        {
          title: 'Section 1 (EN)',
          lessons: [
            { title: 'Intro (EN)', type: 'video', durationMin: 6, summary: 'Video summary.' },
            { title: 'Quiz (EN)', type: 'quiz', durationMin: 5, summary: 'Quiz summary.' },
          ],
        },
      ],
    });
    expect(validateTranslationStructure(original, translated)).toEqual([]);
  });

  it('détecte un nombre de sections divergent', () => {
    const translated = makeOutline({
      sections: [
        ...original.sections,
        {
          title: 'Section 2 en trop',
          lessons: [{ title: 'Quiz', type: 'quiz', durationMin: 5, summary: 'x' }],
        },
      ],
    });
    const problems = validateTranslationStructure(original, translated);
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain('Nombre de sections');
  });

  it('détecte un changement de type ou de durée de leçon', () => {
    const translated = makeOutline({
      sections: [
        {
          title: 'Section 1',
          lessons: [
            // Type changé (video → article) et durée modifiée.
            { title: 'Intro', type: 'article', durationMin: 9, summary: 'x' },
            { title: 'Quiz', type: 'quiz', durationMin: 5, summary: 'y' },
          ],
        },
      ],
    });
    const problems = validateTranslationStructure(original, translated);
    expect(problems.some((p) => p.includes('type'))).toBe(true);
    expect(problems.some((p) => p.includes('durée'))).toBe(true);
  });

  it('détecte un nombre de leçons divergent dans une section', () => {
    const translated = makeOutline({
      sections: [
        {
          title: 'Section 1',
          lessons: [{ title: 'Quiz seul', type: 'quiz', durationMin: 5, summary: 'z' }],
        },
      ],
    });
    const problems = validateTranslationStructure(original, translated);
    expect(problems.some((p) => p.includes('leçons'))).toBe(true);
  });
});

describe('derivedCourseTitle', () => {
  const translateSpec: DerivationSpec = {
    sourceLocale: 'fr',
    targetLocale: 'en',
    sourceDifficulty: 'beginner',
    targetDifficulty: 'beginner',
    translate: true,
  };
  const levelSpec: DerivationSpec = {
    sourceLocale: 'fr',
    targetLocale: 'fr',
    sourceDifficulty: 'beginner',
    targetDifficulty: 'advanced',
    translate: false,
  };

  it('utilise le titre traduit quand la langue change', () => {
    const translated = makeOutline({ title: 'Translated title' });
    expect(derivedCourseTitle('Titre source', translateSpec, translated)).toBe('Translated title');
  });

  it('conserve le titre source pour un changement de niveau seul', () => {
    expect(derivedCourseTitle('Titre source', levelSpec)).toBe('Titre source');
  });
});

describe('contrats de traduction', () => {
  it('réutilise outlineSchema comme schéma de sortie de traduction', () => {
    // Garantit que la structure attendue de la traduction == outline complet.
    expect(translatedOutlineSchema).toBe(outlineSchema);
  });

  it('sérialise le plan source et cible la bonne langue dans le prompt', () => {
    const outline = makeOutline();
    const prompt = translateOutlineUserPrompt(outline, 'en');
    expect(prompt).toContain('anglais');
    // Le JSON du plan source est bien inclus (le worker le traduit).
    expect(prompt).toContain('"title": "Titre du cours"');
    expect(prompt).toContain('"type": "quiz"');
  });
});
