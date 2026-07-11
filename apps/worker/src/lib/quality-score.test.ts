// Tests des fonctions PURES du score de qualité pédagogique (Prompt 94) :
// heuristique mock (déterministe, sans appel LLM) et gate de seuil avant
// déploiement. evaluateCourseQuality (I/O Claude) n'est pas couvert ici.
import { describe, expect, it } from 'vitest';
import { QUALITY_SCORE } from '../shared.js';
import {
  checkQualityGate,
  heuristicClarityScore,
  heuristicEngagementScore,
  heuristicExamplesScore,
  heuristicProgressionScore,
  heuristicQualityEvaluation,
  type LessonForQuality,
} from './quality-score.js';

/** Construit une leçon minimale pour les tests, surchargée au besoin. */
function lesson(overrides: Partial<LessonForQuality> = {}): LessonForQuality {
  return {
    title: 'Leçon',
    type: 'video',
    status: 'ready',
    assets: {} as LessonForQuality['assets'],
    ...overrides,
  } as LessonForQuality;
}

describe('heuristicClarityScore', () => {
  it('retourne un score neutre sans article', () => {
    expect(heuristicClarityScore([lesson({ type: 'video' })])).toBe(15);
  });

  it('note plein pour des articles suffisamment longs (>= 400 mots)', () => {
    const longArticle = Array.from({ length: 500 }, (_, i) => `mot${i}`).join(' ');
    const score = heuristicClarityScore([lesson({ type: 'article', assets: { articleMd: longArticle } as never })]);
    expect(score).toBe(QUALITY_SCORE.RUBRIC_MAX_PER_CRITERION);
  });

  it('pénalise des articles très courts', () => {
    const score = heuristicClarityScore([lesson({ type: 'article', assets: { articleMd: 'Trop court.' } as never })]);
    expect(score).toBeLessThan(QUALITY_SCORE.RUBRIC_MAX_PER_CRITERION);
    expect(score).toBeGreaterThanOrEqual(0);
  });
});

describe('heuristicProgressionScore', () => {
  it('note 0 sans leçon', () => {
    expect(heuristicProgressionScore([])).toBe(0);
  });

  it('note plein avec les 4 types de leçon représentés', () => {
    const lessons = [
      lesson({ type: 'video' }),
      lesson({ type: 'article' }),
      lesson({ type: 'tp' }),
      lesson({ type: 'quiz' }),
    ];
    expect(heuristicProgressionScore(lessons)).toBe(QUALITY_SCORE.RUBRIC_MAX_PER_CRITERION);
  });

  it('note moins avec un seul type de leçon', () => {
    const lessons = [lesson({ type: 'video' }), lesson({ type: 'video' })];
    expect(heuristicProgressionScore(lessons)).toBeLessThan(QUALITY_SCORE.RUBRIC_MAX_PER_CRITERION);
  });
});

describe('heuristicExamplesScore', () => {
  it('note 0 sans leçon', () => {
    expect(heuristicExamplesScore([])).toBe(0);
  });

  it('note plein avec un ratio de TP confortable (>= 1 pour 5 leçons)', () => {
    const lessons = [
      lesson({ type: 'tp' }),
      lesson({ type: 'video' }),
      lesson({ type: 'video' }),
      lesson({ type: 'video' }),
      lesson({ type: 'video' }),
    ];
    expect(heuristicExamplesScore(lessons)).toBe(QUALITY_SCORE.RUBRIC_MAX_PER_CRITERION);
  });

  it('pénalise l’absence de travaux pratiques', () => {
    const lessons = Array.from({ length: 10 }, () => lesson({ type: 'video' }));
    expect(heuristicExamplesScore(lessons)).toBe(0);
  });
});

describe('heuristicEngagementScore', () => {
  it('note 0 sans leçon', () => {
    expect(heuristicEngagementScore([])).toBe(0);
  });

  it('note plein quand toutes les leçons sont prêtes', () => {
    const lessons = [lesson({ status: 'ready' }), lesson({ status: 'ready' })];
    expect(heuristicEngagementScore(lessons)).toBe(QUALITY_SCORE.RUBRIC_MAX_PER_CRITERION);
  });

  it('pénalise proportionnellement les leçons non finalisées', () => {
    const lessons = [lesson({ status: 'ready' }), lesson({ status: 'failed' })];
    expect(heuristicEngagementScore(lessons)).toBe(Math.round(QUALITY_SCORE.RUBRIC_MAX_PER_CRITERION / 2));
  });
});

describe('heuristicQualityEvaluation', () => {
  it('produit un score = somme de la rubrique, conforme au schéma', () => {
    const lessons = [
      lesson({ type: 'video', status: 'ready' }),
      lesson({ type: 'article', status: 'ready', assets: { articleMd: 'x '.repeat(500) } as never }),
      lesson({ type: 'tp', status: 'ready' }),
      lesson({ type: 'quiz', status: 'ready' }),
    ];
    const evaluation = heuristicQualityEvaluation(lessons);
    const { clarity, progression, examples, engagement } = evaluation.rubric;
    expect(evaluation.score).toBe(clarity + progression + examples + engagement);
    expect(evaluation.score).toBeGreaterThanOrEqual(0);
    expect(evaluation.score).toBeLessThanOrEqual(100);
    expect(evaluation.feedback.length).toBeGreaterThan(0);
  });

  it('est déterministe (même entrée → même sortie)', () => {
    const lessons = [lesson({ type: 'video' }), lesson({ type: 'tp' })];
    expect(heuristicQualityEvaluation(lessons)).toEqual(heuristicQualityEvaluation(lessons));
  });

  it('signale les leçons non finalisées dans le feedback', () => {
    const lessons = [lesson({ status: 'ready' }), lesson({ status: 'failed' })];
    const evaluation = heuristicQualityEvaluation(lessons);
    expect(evaluation.feedback.some((f) => /finalis/i.test(f))).toBe(true);
  });
});

describe('checkQualityGate', () => {
  it('autorise toujours quand le score atteint le seuil', () => {
    const result = checkQualityGate(75, false);
    expect(result.allowed).toBe(true);
    expect(result.belowThreshold).toBe(false);
  });

  it('autorise à la limite exacte du seuil', () => {
    const result = checkQualityGate(QUALITY_SCORE.MIN_DEPLOY_THRESHOLD, false);
    expect(result.allowed).toBe(true);
    expect(result.belowThreshold).toBe(false);
  });

  it('bloque sous le seuil sans confirmation, avec un message clair', () => {
    const result = checkQualityGate(40, false);
    expect(result.allowed).toBe(false);
    expect(result.belowThreshold).toBe(true);
    expect(result.message).toMatch(/40\/100/);
    expect(result.message).toMatch(/60/);
  });

  it('autorise sous le seuil avec confirmation explicite (contournement)', () => {
    const result = checkQualityGate(40, true);
    expect(result.allowed).toBe(true);
    expect(result.belowThreshold).toBe(true);
    expect(result.message).toBeDefined();
  });

  it('autorise quand aucune évaluation n’a encore tourné (score null)', () => {
    const result = checkQualityGate(null, false);
    expect(result.allowed).toBe(true);
    expect(result.belowThreshold).toBe(false);
  });

  it('respecte un seuil personnalisé', () => {
    const result = checkQualityGate(50, false, 80);
    expect(result.allowed).toBe(false);
    expect(result.message).toMatch(/80/);
  });
});
