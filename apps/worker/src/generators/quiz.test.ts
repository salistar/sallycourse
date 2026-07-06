// Tests du générateur de quiz : validations métier, génération en mode mock
// (déterministe, zéro appel réseau), Markdown « Quiz + Solutions » et prompts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QUIZ, resetConfigCache, type QuizQuestion } from '../shared.js';
import { mockQuiz } from '../lib/mock-fixtures.js';
import {
  buildQuizMarkdown,
  generateQuizQuestions,
  quizArraySchema,
  validateQuizBusiness,
} from './quiz.js';
import { quizSystemPrompt, quizUserPrompt } from '../prompts/quiz.js';

/** Environnement complet et valide pour getConfig, en mode mock (aucun réseau). */
function setTestEnv(overrides: Record<string, string> = {}): void {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    APP_URL: 'http://localhost:3000',
    MONGO_URI: 'mongodb://localhost:27017/test',
    REDIS_URL: 'redis://localhost:6379',
    S3_ENDPOINT: 'http://localhost:9000',
    S3_ACCESS_KEY: 'test',
    S3_SECRET_KEY: 'test',
    S3_BUCKET: 'test',
    S3_REGION: 'us-east-1',
    AUTH_SECRET: 'secret-de-test-suffisamment-long',
    CREDENTIALS_MASTER_KEY: 'a'.repeat(64),
    MOCK_PROVIDERS: 'true',
    ...overrides,
  });
  resetConfigCache();
}

const PROMPT_INPUT = {
  courseTitle: 'Apprendre Docker de zéro',
  sectionTitle: 'Les fondamentaux indispensables',
  lessonTitle: 'Quiz — Les fondamentaux indispensables',
  difficulty: 'beginner',
  locale: 'fr',
  sectionLessons: [
    { title: 'Comprendre les images', summary: 'Couches, tags et registres.' },
    { title: 'TP : premier conteneur', summary: 'docker run pas à pas.' },
  ],
} as const;

beforeEach(() => setTestEnv());
afterEach(() => resetConfigCache());

describe('prompts quiz', () => {
  it('balise le titre de la section en « … » (extraction mock) et injecte le contexte', () => {
    const user = quizUserPrompt(PROMPT_INPUT);
    expect(user).toContain('« Les fondamentaux indispensables »');
    expect(user).toContain('Comprendre les images');
    expect(user).toContain('Couches, tags et registres.');
    expect(user).toContain('français');
  });

  it('le prompt système exige les bornes partagées et des explications complètes', () => {
    const system = quizSystemPrompt();
    expect(system).toContain(String(QUIZ.MIN_QUESTIONS_PER_SECTION));
    expect(system).toContain(String(QUIZ.MAX_QUESTIONS_PER_SECTION));
    expect(system).toMatch(/pourquoi la bonne réponse est correcte/i);
    expect(system).toMatch(/chacune des autres/i);
    expect(system).toMatch(/plausibles/i);
  });
});

describe('validateQuizBusiness', () => {
  it('accepte la fixture mock (mix de difficultés, choix distincts, explications)', () => {
    expect(validateQuizBusiness(mockQuiz('Docker'))).toEqual([]);
  });

  it('rejette un quiz mono-difficulté', () => {
    const questions = mockQuiz('Docker').map((q) => ({ ...q, difficulty: 'beginner' as const }));
    expect(validateQuizBusiness(questions).join('\n')).toMatch(/difficulté/);
  });

  it('rejette des choix identiques dans une même question', () => {
    const questions = mockQuiz('Docker');
    const first = questions[0] as QuizQuestion;
    first.choices = ['Même choix', 'Même choix', 'Autre', 'Encore un autre'];
    expect(validateQuizBusiness(questions).join('\n')).toMatch(/Question 1.*distincts/);
  });

  it('rejette une explication trop courte', () => {
    const questions = mockQuiz('Docker');
    (questions[2] as QuizQuestion).explanation = 'Trop court.';
    expect(validateQuizBusiness(questions).join('\n')).toMatch(/Question 3.*explication/i);
  });

  it('rejette les questions dupliquées', () => {
    const questions = mockQuiz('Docker');
    (questions[4] as QuizQuestion).question = (questions[1] as QuizQuestion).question;
    expect(validateQuizBusiness(questions).join('\n')).toMatch(/Question 5.*doublon/i);
  });
});

describe('generateQuizQuestions — mode mock', () => {
  it('retourne 8 à 12 questions conformes au schéma partagé, sans appel réseau', async () => {
    const questions = await generateQuizQuestions(PROMPT_INPUT);
    expect(quizArraySchema.safeParse(questions).success).toBe(true);
    expect(questions.length).toBeGreaterThanOrEqual(QUIZ.MIN_QUESTIONS_PER_SECTION);
    expect(questions.length).toBeLessThanOrEqual(QUIZ.MAX_QUESTIONS_PER_SECTION);
    expect(validateQuizBusiness(questions)).toEqual([]);
  });

  it('est déterministe : même section → mêmes questions', async () => {
    const a = await generateQuizQuestions(PROMPT_INPUT);
    const b = await generateQuizQuestions(PROMPT_INPUT);
    expect(a).toEqual(b);
  });
});

describe('buildQuizMarkdown', () => {
  it('produit les questions puis les solutions avec lettre correcte et explication', () => {
    const questions = mockQuiz('Docker', QUIZ.MIN_QUESTIONS_PER_SECTION);
    const markdown = buildQuizMarkdown({
      courseTitle: PROMPT_INPUT.courseTitle,
      sectionTitle: PROMPT_INPUT.sectionTitle,
      lessonTitle: PROMPT_INPUT.lessonTitle,
      questions,
    });

    expect(markdown).toContain('## Questions');
    expect(markdown).toContain('## Solutions');
    // La partie « Questions » précède la partie « Solutions ».
    expect(markdown.indexOf('## Questions')).toBeLessThan(markdown.indexOf('## Solutions'));

    const first = questions[0] as QuizQuestion;
    const letter = String.fromCharCode(65 + first.correctIndex);
    expect(markdown).toContain(first.question);
    expect(markdown).toContain(`### Question 1 — bonne réponse : ${letter}`);
    expect(markdown).toContain(first.explanation);
    // Toutes les questions sont présentes, avec leur difficulté affichée.
    questions.forEach((q, i) => {
      expect(markdown).toContain(`### Question ${i + 1} (${q.difficulty})`);
    });
  });
});
