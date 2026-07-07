// Les fixtures golden doivent TOUJOURS valider contre les schémas Zod partagés :
// si un schéma évolue, ce test casse avant que le seed ne produise des documents
// invalides. Aucun accès Mongo ici (validation pure).
import { describe, expect, it } from 'vitest';
import {
  articleContentSchema,
  outlineSchema,
  quizQuestionSchema,
  slideScriptSchema,
  tpSchema,
  UDEMY,
  QUIZ,
} from '../shared.js';
import {
  DEMO_ADMIN,
  DEMO_PASSWORD_BCRYPT,
  DEMO_USERS,
  GOLDEN_ARTICLE,
  GOLDEN_OUTLINE,
  GOLDEN_TP,
  GOLDEN_VIDEO_SCRIPT,
  goldenQuizForSection,
  isDemoEmail,
} from './fixtures.js';

describe('fixtures de démo — conformité aux schémas Zod', () => {
  it('GOLDEN_OUTLINE respecte outlineSchema', () => {
    expect(outlineSchema.safeParse(GOLDEN_OUTLINE).success).toBe(true);
  });

  it('GOLDEN_OUTLINE respecte les règles Udemy (sections, objectifs, titres)', () => {
    expect(GOLDEN_OUTLINE.sections.length).toBeGreaterThanOrEqual(UDEMY.MIN_SECTIONS);
    expect(GOLDEN_OUTLINE.learningObjectives.length).toBeGreaterThanOrEqual(UDEMY.MIN_LEARNING_OBJECTIVES);
    expect(GOLDEN_OUTLINE.title.length).toBeLessThanOrEqual(UDEMY.TITLE_MAX_CHARS);
    expect(GOLDEN_OUTLINE.subtitle.length).toBeLessThanOrEqual(UDEMY.SUBTITLE_MAX_CHARS);
  });

  it('le cumul des minutes vidéo atteint le minimum Udemy', () => {
    const videoMinutes = GOLDEN_OUTLINE.sections
      .flatMap((s) => s.lessons)
      .filter((l) => l.type === 'video')
      .reduce((acc, l) => acc + l.durationMin, 0);
    expect(videoMinutes).toBeGreaterThanOrEqual(UDEMY.MIN_TOTAL_VIDEO_MINUTES);
  });

  it('GOLDEN_VIDEO_SCRIPT respecte slideScriptSchema', () => {
    expect(slideScriptSchema.safeParse(GOLDEN_VIDEO_SCRIPT).success).toBe(true);
  });

  it('GOLDEN_ARTICLE respecte articleContentSchema', () => {
    expect(articleContentSchema.safeParse(GOLDEN_ARTICLE).success).toBe(true);
  });

  it('GOLDEN_TP respecte tpSchema', () => {
    expect(tpSchema.safeParse(GOLDEN_TP).success).toBe(true);
  });

  it('goldenQuizForSection produit des questions valides et déterministes', () => {
    const a = goldenQuizForSection(0);
    const b = goldenQuizForSection(0);
    expect(a).toEqual(b); // déterminisme
    expect(a.length).toBeGreaterThanOrEqual(QUIZ.MIN_QUESTIONS_PER_SECTION);
    for (const q of a) {
      expect(quizQuestionSchema.safeParse(q).success).toBe(true);
      expect(q.choices).toHaveLength(QUIZ.CHOICES_PER_QUESTION);
      expect(q.correctIndex).toBeGreaterThanOrEqual(0);
      expect(q.correctIndex).toBeLessThan(QUIZ.CHOICES_PER_QUESTION);
    }
  });
});

describe('fixtures de démo — comptes', () => {
  it('tous les e-mails de démo sont reconnus par isDemoEmail', () => {
    expect(isDemoEmail(DEMO_ADMIN.email)).toBe(true);
    for (const u of DEMO_USERS) expect(isDemoEmail(u.email)).toBe(true);
    expect(isDemoEmail('vrai.user@exemple.com')).toBe(false);
  });

  it('un utilisateur par plan est défini', () => {
    const plans = DEMO_USERS.map((u) => u.plan).sort();
    expect(plans).toEqual(['business', 'free', 'pro']);
  });

  it('le hash bcrypt de démo a un format valide', () => {
    expect(DEMO_PASSWORD_BCRYPT).toMatch(/^\$2[aby]\$\d{2}\$.{53}$/);
  });
});
