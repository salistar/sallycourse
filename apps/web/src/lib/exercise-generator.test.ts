import { describe, expect, it, vi } from 'vitest';

// Tests du générateur d'exercices supplémentaires (Prompt 145) :
// - sélection PURE des thèmes faibles depuis l'historique des réponses ratées ;
// - construction du prompt ciblé (system/user) ;
// - callClaudeJson-like mocké via MOCK_PROVIDERS (fixture déterministe, sans réseau).

vi.mock('@sallycourse/shared', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getConfig: () => ({ MOCK_PROVIDERS: true, ANTHROPIC_API_KEY: undefined }),
  };
});

vi.mock('./logger', () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const {
  selectWeakThemes,
  exerciseCountForThemes,
  exerciseSystemPrompt,
  exerciseUserPrompt,
  generatePersonalizedExercises,
  EXERCISE_MIN_QUESTIONS,
  EXERCISE_MAX_QUESTIONS,
} = await import('./exercise-generator');

describe('selectWeakThemes (pure)', () => {
  it('retourne un tableau vide sans réponses ratées', () => {
    expect(selectWeakThemes([])).toEqual([]);
  });

  it('déduplique et trie du thème le plus fréquent au moins fréquent', () => {
    const wrongAnswers = [
      { question: 'Q1', theme: 'boucles', pickedIndex: 1, correctIndex: 0 },
      { question: 'Q2', theme: 'variables', pickedIndex: 2, correctIndex: 1 },
      { question: 'Q3', theme: 'boucles', pickedIndex: 0, correctIndex: 3 },
      { question: 'Q4', theme: 'boucles', pickedIndex: 1, correctIndex: 2 },
    ];
    expect(selectWeakThemes(wrongAnswers)).toEqual(['boucles', 'variables']);
  });

  it('ignore les thèmes vides/blancs', () => {
    const wrongAnswers = [
      { question: 'Q1', theme: '  ', pickedIndex: 0, correctIndex: 1 },
      { question: 'Q2', theme: 'fonctions', pickedIndex: 0, correctIndex: 1 },
    ];
    expect(selectWeakThemes(wrongAnswers)).toEqual(['fonctions']);
  });
});

describe('exerciseCountForThemes (pure)', () => {
  it('retourne le minimum quand aucun thème', () => {
    expect(exerciseCountForThemes(0)).toBe(EXERCISE_MIN_QUESTIONS);
  });

  it('augmente avec le nombre de thèmes distincts, borné au maximum', () => {
    expect(exerciseCountForThemes(1)).toBe(EXERCISE_MIN_QUESTIONS);
    expect(exerciseCountForThemes(3)).toBe(4);
    expect(exerciseCountForThemes(10)).toBe(EXERCISE_MAX_QUESTIONS);
  });
});

describe('exerciseSystemPrompt / exerciseUserPrompt (pure)', () => {
  it('le prompt système impose le format JSON strict et le nombre de choix', () => {
    const system = exerciseSystemPrompt();
    expect(system).toContain('JSON');
    expect(system).toContain('4');
  });

  it('le prompt utilisateur cible les thèmes faibles et référence les questions ratées', () => {
    const user = exerciseUserPrompt({
      courseTitle: 'Python pour débutants',
      lessonTitle: 'Quiz — Les boucles',
      locale: 'fr',
      weakThemes: ['boucles for', 'boucles while'],
      wrongAnswers: [
        { question: 'Que fait range(5) ?', theme: 'boucles for', pickedIndex: 1, correctIndex: 0 },
      ],
      questionCount: 4,
    });
    expect(user).toContain('Python pour débutants');
    expect(user).toContain('Quiz — Les boucles');
    expect(user).toContain('boucles for');
    expect(user).toContain('boucles while');
    expect(user).toContain('Que fait range(5) ?');
    expect(user).toContain('4 nouvelles questions');
  });
});

describe('generatePersonalizedExercises (mode mock)', () => {
  it('génère le nombre de questions demandé, sans appel réseau', async () => {
    const result = await generatePersonalizedExercises({
      courseTitle: 'Cours test',
      lessonTitle: 'Leçon quiz',
      locale: 'fr',
      weakThemes: ['thème A', 'thème B'],
      wrongAnswers: [
        { question: 'Q1', theme: 'thème A', pickedIndex: 1, correctIndex: 0 },
      ],
      questionCount: 4,
    });
    expect(result).toHaveLength(4);
    for (const q of result) {
      expect(q.choices).toHaveLength(4);
      expect(q.explanation.length).toBeGreaterThan(0);
    }
  });

  it('retombe sur un thème générique si aucun thème faible fourni', async () => {
    const result = await generatePersonalizedExercises({
      courseTitle: 'Cours test',
      lessonTitle: 'Leçon quiz',
      locale: 'fr',
      weakThemes: [],
      wrongAnswers: [],
      questionCount: 3,
    });
    expect(result).toHaveLength(3);
    expect(result[0]?.question).toContain('révision générale');
  });
});
