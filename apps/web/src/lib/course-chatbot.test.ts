import { describe, expect, it, vi } from 'vitest';

// Tests de l'assistant de cours (Prompt 146) côté web :
// - recherche PURE des passages pertinents (réutilise la même approche que
//   worker/lib/content-similarity : n-grams + indice de Jaccard) ;
// - construction du prompt (system/user) avec contexte ;
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
  answerCourseQuestion,
  COURSE_CHATBOT,
  courseChatbotSystemPrompt,
  courseChatbotUserPrompt,
  findRelevantPassages,
} = await import('./course-chatbot');

const REACT_LESSON = {
  id: 'lesson-react',
  title: 'Introduction à React',
  type: 'video',
  script: {
    slides: [
      { narration: 'React est une bibliothèque JavaScript pour construire des interfaces utilisateur.' },
      { narration: 'Elle utilise un DOM virtuel pour optimiser les mises à jour de rendu.' },
    ],
  },
};

const DOCKER_LESSON = {
  id: 'lesson-docker',
  title: 'Conteneurs Docker',
  type: 'article',
  assets: {
    articleMd:
      'Docker permet de conteneuriser une application avec toutes ses dépendances. ' +
      'Un conteneur Docker est isolé du système hôte et reproductible sur toute machine.',
  },
};

const QUIZ_LESSON = {
  id: 'lesson-quiz',
  title: 'Quiz final',
  type: 'quiz',
  summary: 'Quiz de validation des acquis.',
};

describe('findRelevantPassages (pure)', () => {
  it('retourne la leçon la plus pertinente en tête, avec un score positif', () => {
    const passages = findRelevantPassages(
      'Comment React utilise-t-il le DOM virtuel pour le rendu ?',
      [REACT_LESSON, DOCKER_LESSON, QUIZ_LESSON],
    );
    expect(passages.length).toBeGreaterThan(0);
    expect(passages[0]!.lessonId).toBe('lesson-react');
    expect(passages[0]!.score).toBeGreaterThan(0);
  });

  it('ne retourne jamais plus de COURSE_CHATBOT.TOP_K passages', () => {
    const manyLessons = Array.from({ length: 10 }, (_, i) => ({
      id: `lesson-${i}`,
      title: `Leçon React ${i}`,
      type: 'article',
      assets: {
        articleMd: 'React est une bibliothèque JavaScript pour construire des interfaces utilisateur modernes.',
      },
    }));
    const passages = findRelevantPassages('Qu’est-ce que React ?', manyLessons);
    expect(passages.length).toBeLessThanOrEqual(COURSE_CHATBOT.TOP_K);
  });

  it('retourne un tableau vide si aucune leçon ne recouvre la question', () => {
    const passages = findRelevantPassages(
      'Quelle est la recette de la tarte tatin traditionnelle française ?',
      [REACT_LESSON, DOCKER_LESSON],
    );
    expect(passages).toEqual([]);
  });
});

describe('courseChatbotSystemPrompt / courseChatbotUserPrompt (pure)', () => {
  it('inclut la langue demandée dans le prompt système', () => {
    expect(courseChatbotSystemPrompt('fr')).toContain('français');
    expect(courseChatbotSystemPrompt('en')).toContain('anglais');
  });

  it('inclut la question et les passages (avec lessonId) dans le prompt utilisateur', () => {
    const passages = findRelevantPassages('Qu’est-ce que React ?', [REACT_LESSON]);
    const prompt = courseChatbotUserPrompt('Qu’est-ce que React ?', passages);
    expect(prompt).toContain('Qu’est-ce que React ?');
    expect(prompt).toContain('lesson-react');
    expect(prompt).toContain('Introduction à React');
  });

  it('signale explicitement l’absence de passage pertinent', () => {
    const prompt = courseChatbotUserPrompt('Question hors sujet', []);
    expect(prompt).toContain('Aucun extrait pertinent');
  });
});

describe('answerCourseQuestion (mode mock)', () => {
  it('cite les leçons sources quand des passages pertinents existent', async () => {
    const result = await answerCourseQuestion({
      question: 'Comment React gère-t-il le rendu avec le DOM virtuel ?',
      lessons: [REACT_LESSON, DOCKER_LESSON, QUIZ_LESSON],
      locale: 'fr',
    });
    expect(result.sourceLessonIds).toContain('lesson-react');
    expect(result.answer.length).toBeGreaterThan(0);
  });

  it('répond honnêtement (aucune source) quand rien n’est pertinent', async () => {
    const result = await answerCourseQuestion({
      question: 'Quelle est la recette de la tarte tatin ?',
      lessons: [REACT_LESSON],
    });
    expect(result.sourceLessonIds).toEqual([]);
  });
});
