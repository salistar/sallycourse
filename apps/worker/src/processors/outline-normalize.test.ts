import { describe, expect, it } from 'vitest';
import { normalizeOutlineQuizzes, validateOutlineBusiness } from './outline-generation.js';
import type { Outline } from '../shared.js';

// Fixture minimale : 4 sections, chacune avec 1 vidéo (parfois longue) + 1 article,
// SANS quiz — pour observer la normalisation des quiz selon quizPosition.
function baseOutline(): Outline {
  const section = (n: number, videoMin: number) => ({
    title: `Section ${n}`,
    lessons: [
      { title: `Vidéo ${n}`, type: 'video' as const, durationMin: videoMin, summary: 's' },
      { title: `Article ${n}`, type: 'article' as const, durationMin: 5, summary: 's' },
    ],
  });
  return {
    title: 'Cours de test',
    subtitle: 'st',
    description: 'desc',
    learningObjectives: ['a', 'b', 'c', 'd'],
    prerequisites: [],
    targetAudience: [],
    sections: [section(1, 10), section(2, 6), section(3, 12), section(4, 4)],
  };
}

describe('normalizeOutlineQuizzes — quizPosition', () => {
  it("défaut (per-section) : ajoute exactement 1 quiz final à CHAQUE section", () => {
    const out = normalizeOutlineQuizzes(baseOutline());
    expect(out.sections).toHaveLength(4);
    for (const s of out.sections) {
      const quizzes = s.lessons.filter((l) => l.type === 'quiz');
      expect(quizzes).toHaveLength(1);
      expect(s.lessons[s.lessons.length - 1]!.type).toBe('quiz');
    }
  });

  it("'final-only' : ne met PAS de quiz par section, garantit un unique quiz final", () => {
    const out = normalizeOutlineQuizzes(baseOutline(), 'final-only');
    const totalQuizzes = out.sections.flatMap((s) => s.lessons).filter((l) => l.type === 'quiz').length;
    expect(totalQuizzes).toBe(1);
    // le quiz est placé dans la dernière section
    expect(out.sections[out.sections.length - 1]!.lessons.some((l) => l.type === 'quiz')).toBe(true);
    // les autres sections n'ont pas de quiz
    expect(out.sections[0]!.lessons.some((l) => l.type === 'quiz')).toBe(false);
  });

  it("'mid-course' : un seul quiz, placé vers le milieu", () => {
    const out = normalizeOutlineQuizzes(baseOutline(), 'mid-course');
    const total = out.sections.flatMap((s) => s.lessons).filter((l) => l.type === 'quiz').length;
    expect(total).toBe(1);
    expect(out.sections[2]!.lessons.some((l) => l.type === 'quiz')).toBe(true); // floor(4/2)=2
  });

  it('plafond vidéo par défaut = 7 min ; relevé si videoCapMin fourni (cloud)', () => {
    const capped = normalizeOutlineQuizzes(baseOutline());
    const maxCapped = Math.max(...capped.sections.flatMap((s) => s.lessons).filter((l) => l.type === 'video').map((l) => l.durationMin));
    expect(maxCapped).toBe(7);
    const cloud = normalizeOutlineQuizzes(baseOutline(), 'per-section', 12);
    const maxCloud = Math.max(...cloud.sections.flatMap((s) => s.lessons).filter((l) => l.type === 'video').map((l) => l.durationMin));
    expect(maxCloud).toBe(12); // les vidéos de 10 et 12 min ne sont plus rabotées à 7
  });
});

describe('validateOutlineBusiness — quizPosition', () => {
  it('per-section (défaut) : exige 1 quiz par section', () => {
    const outNoQuiz = baseOutline();
    const problems = validateOutlineBusiness(outNoQuiz);
    expect(problems.some((p) => p.includes('quiz'))).toBe(true);
    // Après normalisation per-section, plus d'erreur quiz.
    const normalized = normalizeOutlineQuizzes(outNoQuiz);
    expect(validateOutlineBusiness(normalized).some((p) => p.includes('quiz'))).toBe(false);
  });

  it("'final-only' : n'exige PAS 1 quiz/section, mais au moins un quiz total", () => {
    const normalized = normalizeOutlineQuizzes(baseOutline(), 'final-only');
    const problems = validateOutlineBusiness(normalized, 'final-only');
    // le quiz unique final satisfait la règle « au moins un quiz »
    expect(problems.some((p) => p.toLowerCase().includes('quiz'))).toBe(false);
  });
});
