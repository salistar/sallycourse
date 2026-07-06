// Tests des fixtures mock : validité contre les schémas partagés, règles
// métier Udemy et déterminisme (même titre → même fixture).
import { describe, expect, it } from 'vitest';
import { outlineSchema, quizQuestionSchema, UDEMY, QUIZ } from '../shared.js';
import {
  extractTitleFromPrompt,
  hashString,
  mockArticle,
  mockFixtureFor,
  mockOutline,
  mockQuiz,
  mockTp,
  mockVideoScript,
  mockArticleSchema,
  mockTpSchema,
  mockVideoScriptSchema,
} from './mock-fixtures.js';

const TITLE = 'Apprendre Docker de zéro';

describe('mockOutline', () => {
  it('est valide contre outlineSchema', () => {
    expect(outlineSchema.safeParse(mockOutline(TITLE)).success).toBe(true);
  });

  it('respecte les règles métier : 5 sections / 22 leçons, quiz final, ≥30 min vidéo', () => {
    const outline = mockOutline(TITLE);
    expect(outline.sections).toHaveLength(5);
    expect(outline.sections.length).toBeGreaterThanOrEqual(UDEMY.MIN_SECTIONS);

    const lessons = outline.sections.flatMap((s) => s.lessons);
    expect(lessons).toHaveLength(22);

    const videoMinutes = lessons.filter((l) => l.type === 'video').reduce((a, l) => a + l.durationMin, 0);
    expect(videoMinutes).toBeGreaterThanOrEqual(UDEMY.MIN_TOTAL_VIDEO_MINUTES);

    for (const section of outline.sections) {
      const quizzes = section.lessons.filter((l) => l.type === 'quiz');
      expect(quizzes).toHaveLength(1);
      expect(section.lessons.at(-1)?.type).toBe('quiz');
    }

    expect(outline.title.length).toBeLessThanOrEqual(UDEMY.TITLE_MAX_CHARS);
    expect(outline.subtitle.length).toBeLessThanOrEqual(UDEMY.SUBTITLE_MAX_CHARS);
  });

  it('est déterministe par titre et paramétré par le titre', () => {
    expect(mockOutline(TITLE)).toEqual(mockOutline(TITLE));
    expect(mockOutline(TITLE)).not.toEqual(mockOutline('Maîtriser Kubernetes'));
    expect(JSON.stringify(mockOutline(TITLE))).toContain('Docker');
  });
});

describe('autres fixtures', () => {
  it('mockQuiz est valide contre quizQuestionSchema et déterministe', () => {
    const quiz = mockQuiz(TITLE);
    expect(quiz).toHaveLength(QUIZ.MIN_QUESTIONS_PER_SECTION);
    for (const question of quiz) {
      expect(quizQuestionSchema.safeParse(question).success).toBe(true);
      expect(question.choices).toHaveLength(QUIZ.CHOICES_PER_QUESTION);
      expect(question.choices[question.correctIndex]).toContain('Réponse correcte');
    }
    expect(mockQuiz(TITLE)).toEqual(mockQuiz(TITLE));
  });

  it('script vidéo, article et TP valident leurs schémas respectifs', () => {
    expect(mockVideoScriptSchema.safeParse(mockVideoScript(TITLE)).success).toBe(true);
    expect(mockArticleSchema.safeParse(mockArticle(TITLE)).success).toBe(true);
    expect(mockTpSchema.safeParse(mockTp(TITLE)).success).toBe(true);
  });
});

describe('mockFixtureFor', () => {
  it("choisit la fixture correspondant au schéma demandé (dispatch par validation)", () => {
    const user = `Génère le plan complet.\nTitre du cours : « ${TITLE} »`;
    const outline = mockFixtureFor(outlineSchema, user);
    expect(outline.sections).toHaveLength(5);
    expect(outline.title).toContain('Docker');

    const question = mockFixtureFor(quizQuestionSchema, user);
    expect(question.choices).toHaveLength(4);
  });

  it('jette une erreur explicite si aucun fixture ne correspond', () => {
    const impossible = outlineSchema.extend({}).refine(() => false, { message: 'jamais' });
    expect(() => mockFixtureFor(impossible, TITLE)).toThrow(/aucun fixture/);
  });
});

describe('helpers', () => {
  it('hashString est stable et distingue les entrées', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });

  it('extractTitleFromPrompt lit les guillemets français puis les libellés', () => {
    expect(extractTitleFromPrompt('Titre du cours : « Python avancé »\nNiveau : x')).toBe('Python avancé');
    expect(extractTitleFromPrompt('Titre : "Excel express"')).toBe('Excel express');
    expect(extractTitleFromPrompt('Un prompt sans balise')).toBe('Un prompt sans balise');
  });
});
