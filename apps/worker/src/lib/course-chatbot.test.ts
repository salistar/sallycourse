// Tests de l'assistant de cours (Prompt 146) : recherche de passages pertinents
// (pure, réutilise content-similarity) et construction du prompt/appel avec
// contexte (callClaudeJson mocké — aucun appel réseau réel).
import { afterEach, describe, expect, it, vi } from 'vitest';

const callClaudeJsonMock = vi.hoisted(() => vi.fn());
vi.mock('./claude.js', () => ({
  callClaudeJson: (...args: unknown[]) => callClaudeJsonMock(...args),
}));

afterEach(() => {
  vi.clearAllMocks();
});

import {
  answerCourseQuestion,
  COURSE_CHATBOT,
  courseChatbotSystemPrompt,
  courseChatbotUserPrompt,
  findRelevantPassages,
  type ChatbotLessonInput,
} from './course-chatbot.js';

const REACT_LESSON: ChatbotLessonInput = {
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

const DOCKER_LESSON: ChatbotLessonInput = {
  id: 'lesson-docker',
  title: 'Conteneurs Docker',
  type: 'article',
  assets: {
    articleMd:
      'Docker permet de conteneuriser une application avec toutes ses dépendances. ' +
      'Un conteneur Docker est isolé du système hôte et reproductible sur toute machine.',
    screenshots: [],
    slides: [],
  },
};

const QUIZ_LESSON: ChatbotLessonInput = {
  id: 'lesson-quiz',
  title: 'Quiz final',
  type: 'quiz',
  summary: 'Quiz de validation des acquis.',
};

describe('findRelevantPassages', () => {
  it('retourne la leçon la plus pertinente en tête, avec un score positif', () => {
    const passages = findRelevantPassages(
      'Comment React utilise-t-il le DOM virtuel pour le rendu ?',
      [REACT_LESSON, DOCKER_LESSON, QUIZ_LESSON],
    );
    expect(passages.length).toBeGreaterThan(0);
    expect(passages[0]!.lessonId).toBe('lesson-react');
    expect(passages[0]!.score).toBeGreaterThan(0);
  });

  it('exclut les leçons sans recouvrement mots-clés significatif', () => {
    const passages = findRelevantPassages('Comment isoler une application avec des conteneurs Docker ?', [
      REACT_LESSON,
      DOCKER_LESSON,
    ]);
    expect(passages.some((p) => p.lessonId === 'lesson-docker')).toBe(true);
  });

  it('ne retourne jamais plus de COURSE_CHATBOT.TOP_K passages', () => {
    const manyLessons: ChatbotLessonInput[] = Array.from({ length: 10 }, (_, i) => ({
      id: `lesson-${i}`,
      title: `Leçon React ${i}`,
      type: 'article',
      assets: {
        articleMd: 'React est une bibliothèque JavaScript pour construire des interfaces utilisateur modernes.',
        screenshots: [],
        slides: [],
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

  it('tronque les passages trop longs', () => {
    const longText = 'mot '.repeat(2000);
    const passages = findRelevantPassages('mot', [
      { id: 'l1', title: 'Longue leçon', type: 'article', assets: { articleMd: longText, screenshots: [], slides: [] } },
    ]);
    expect(passages[0]!.excerpt.length).toBeLessThanOrEqual(COURSE_CHATBOT.MAX_PASSAGE_CHARS + 1);
  });
});

describe('courseChatbotSystemPrompt / courseChatbotUserPrompt', () => {
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
    expect(prompt).toContain("Aucun extrait pertinent");
  });
});

describe('answerCourseQuestion', () => {
  it('construit le contexte à partir des passages pertinents puis appelle callClaudeJson', async () => {
    callClaudeJsonMock.mockResolvedValue({ answer: 'React utilise un DOM virtuel.', sourceLessonIds: ['lesson-react'] });

    const result = await answerCourseQuestion({
      question: 'Comment React gère-t-il le rendu avec le DOM virtuel ?',
      lessons: [REACT_LESSON, DOCKER_LESSON, QUIZ_LESSON],
      locale: 'fr',
    });

    expect(result).toEqual({ answer: 'React utilise un DOM virtuel.', sourceLessonIds: ['lesson-react'] });
    expect(callClaudeJsonMock).toHaveBeenCalledTimes(1);
    const call = callClaudeJsonMock.mock.calls[0]![0] as { system: string; user: string };
    expect(call.system).toContain('français');
    expect(call.user).toContain('lesson-react');
    expect(call.user).toContain('Comment React gère-t-il le rendu avec le DOM virtuel ?');
  });

  it('appelle quand même Claude (contexte vide) quand aucun passage pertinent n’est trouvé', async () => {
    callClaudeJsonMock.mockResolvedValue({
      answer: "Je ne trouve pas cette information dans le cours.",
      sourceLessonIds: [],
    });

    const result = await answerCourseQuestion({
      question: 'Quelle est la recette de la tarte tatin ?',
      lessons: [REACT_LESSON],
    });

    expect(result.sourceLessonIds).toEqual([]);
    const call = callClaudeJsonMock.mock.calls[0]![0] as { user: string };
    expect(call.user).toContain('Aucun extrait pertinent');
  });
});
