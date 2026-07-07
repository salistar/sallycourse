import { describe, expect, it } from 'vitest';
import {
  allAnswered,
  gradeQuiz,
  isPreviewFinished,
  nextLessonIndex,
  prevLessonIndex,
  previewProgressPercent,
} from './preview-logic';

describe('navigation séquentielle', () => {
  it('nextLessonIndex avance et s’arrête à la fin', () => {
    expect(nextLessonIndex(0, 3)).toBe(1);
    expect(nextLessonIndex(1, 3)).toBe(2);
    expect(nextLessonIndex(2, 3)).toBeNull();
  });

  it('prevLessonIndex recule et s’arrête au début', () => {
    expect(prevLessonIndex(2, 3)).toBe(1);
    expect(prevLessonIndex(1, 3)).toBe(0);
    expect(prevLessonIndex(0, 3)).toBeNull();
  });

  it('borne les index hors limites', () => {
    expect(nextLessonIndex(99, 3)).toBeNull();
    expect(prevLessonIndex(-5, 3)).toBeNull();
    expect(nextLessonIndex(-5, 3)).toBe(1);
  });

  it('cours vide → pas de voisin', () => {
    expect(nextLessonIndex(0, 0)).toBeNull();
    expect(prevLessonIndex(0, 0)).toBeNull();
  });
});

describe('progression locale', () => {
  it('calcule un pourcentage arrondi borné', () => {
    expect(previewProgressPercent(0, 4)).toBe(0);
    expect(previewProgressPercent(1, 4)).toBe(25);
    expect(previewProgressPercent(3, 4)).toBe(75);
    expect(previewProgressPercent(4, 4)).toBe(100);
  });

  it('gère total 0 et sur-comptage', () => {
    expect(previewProgressPercent(2, 0)).toBe(0);
    expect(previewProgressPercent(9, 4)).toBe(100);
  });

  it('isPreviewFinished vrai seulement si tout est vu', () => {
    expect(isPreviewFinished(4, 4)).toBe(true);
    expect(isPreviewFinished(3, 4)).toBe(false);
    expect(isPreviewFinished(0, 0)).toBe(false);
  });
});

describe('notation du quiz (solutions après soumission)', () => {
  const correct = [1, 0, 2];

  it('note toutes correctes → 100 % et réussi', () => {
    const g = gradeQuiz(correct, [1, 0, 2]);
    expect(g).toEqual({ correct: 3, total: 3, percent: 100, passed: true });
  });

  it('note un mélange et applique le seuil 70 %', () => {
    const g = gradeQuiz(correct, [1, 0, 0]); // 2/3 = 67 %
    expect(g.correct).toBe(2);
    expect(g.percent).toBe(67);
    expect(g.passed).toBe(false);
  });

  it('réponses manquantes comptées fausses', () => {
    const g = gradeQuiz(correct, [1, null, undefined]);
    expect(g.correct).toBe(1);
    expect(g.passed).toBe(false);
  });

  it('seuil personnalisable', () => {
    expect(gradeQuiz(correct, [1, 0, 0], 60).passed).toBe(true); // 67 % ≥ 60
  });

  it('quiz vide → non réussi', () => {
    expect(gradeQuiz([], [])).toEqual({ correct: 0, total: 0, percent: 0, passed: false });
  });
});

describe('allAnswered', () => {
  it('vrai seulement quand toutes les questions ont une réponse', () => {
    expect(allAnswered(3, [0, 1, 2])).toBe(true);
    expect(allAnswered(3, [0, null, 2])).toBe(false);
    expect(allAnswered(3, [0, 1])).toBe(false);
    expect(allAnswered(0, [])).toBe(false);
  });
});
