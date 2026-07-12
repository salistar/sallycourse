import { describe, it, expect } from 'vitest';
import { computeDropoutHeatmap } from './dropout-heatmap';
import type { HeatmapLessonRef, HeatmapProgressRow } from './dropout-heatmap';

function lesson(id: string, sectionOrder: number, lessonOrder: number, title: string): HeatmapLessonRef {
  return { lessonId: id, sectionOrder, lessonOrder, title };
}

describe('computeDropoutHeatmap', () => {
  const lessons: HeatmapLessonRef[] = [
    lesson('l1', 0, 0, 'Introduction'),
    lesson('l2', 2, 1, 'Concepts avancés'), // section 3, leçon 2 → label "3.2"
  ];

  it('calcule le taux de complétion/abandon par leçon', () => {
    const progress: HeatmapProgressRow[] = [
      { studentId: 's1', lessonId: 'l1', completedAt: new Date() },
      { studentId: 's2', lessonId: 'l1', completedAt: new Date() },
      { studentId: 's1', lessonId: 'l2', completedAt: new Date() },
    ];
    const result = computeDropoutHeatmap(lessons, progress, 10);
    expect(result.points[0]).toMatchObject({
      lessonId: 'l1',
      label: '1.1',
      completedCount: 2,
      completionRate: 20,
      dropoutRate: 80,
    });
    expect(result.points[1]).toMatchObject({
      lessonId: 'l2',
      label: '3.2',
      completedCount: 1,
      completionRate: 10,
      dropoutRate: 90,
    });
  });

  it('trie les points par (sectionOrder, lessonOrder) quel que soit l’ordre d’entrée', () => {
    const shuffled = [lessons[1]!, lessons[0]!];
    const result = computeDropoutHeatmap(shuffled, [], 5);
    expect(result.points.map((p) => p.lessonId)).toEqual(['l1', 'l2']);
  });

  it('déduplique les complétions multiples du même apprenant', () => {
    const progress: HeatmapProgressRow[] = [
      { studentId: 's1', lessonId: 'l1', completedAt: new Date('2026-01-01') },
      { studentId: 's1', lessonId: 'l1', completedAt: new Date('2026-01-02') },
    ];
    const result = computeDropoutHeatmap(lessons, progress, 1);
    expect(result.points[0]!.completedCount).toBe(1);
    expect(result.points[0]!.completionRate).toBe(100);
  });

  it('ignore les lignes sans completedAt (leçon commencée mais pas terminée)', () => {
    const progress: HeatmapProgressRow[] = [{ studentId: 's1', lessonId: 'l1', completedAt: null }];
    const result = computeDropoutHeatmap(lessons, progress, 1);
    expect(result.points[0]!.completedCount).toBe(0);
  });

  it('aucun inscrit → taux à zéro, pas de division par zéro', () => {
    const result = computeDropoutHeatmap(lessons, [], 0);
    expect(result.points.every((p) => p.completionRate === 0 && p.dropoutRate === 0)).toBe(true);
    expect(result.suggestion).toBe('');
  });

  it('identifie le pire point et génère une suggestion au-delà du seuil (40%)', () => {
    const progress: HeatmapProgressRow[] = [
      { studentId: 's1', lessonId: 'l1', completedAt: new Date() },
      { studentId: 's2', lessonId: 'l1', completedAt: new Date() },
      // l2 : personne ne la termine → 100% d'abandon
    ];
    const result = computeDropoutHeatmap(lessons, progress, 2);
    expect(result.worstPoint?.lessonId).toBe('l2');
    expect(result.suggestion).toContain('3.2');
    expect(result.suggestion).toContain('régénération');
  });

  it('pas de suggestion sous le seuil de 40%', () => {
    const progress: HeatmapProgressRow[] = [
      { studentId: 's1', lessonId: 'l1', completedAt: new Date() },
      { studentId: 's2', lessonId: 'l1', completedAt: new Date() },
      { studentId: 's1', lessonId: 'l2', completedAt: new Date() },
      { studentId: 's2', lessonId: 'l2', completedAt: new Date() },
    ];
    const result = computeDropoutHeatmap(lessons, progress, 2);
    expect(result.suggestion).toBe('');
  });

  it('liste de leçons vide → aucun point, pas de pire point', () => {
    const result = computeDropoutHeatmap([], [], 10);
    expect(result.points).toEqual([]);
    expect(result.worstPoint).toBeNull();
  });
});
