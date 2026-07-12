// Heatmap d'abandon (Prompt 144) — logique PURE, testable sans I/O. Calcule,
// pour chaque leçon d'un cours (dans l'ordre du plan de cours), le % des
// apprenants inscrits qui n'ont jamais atteint/terminé cette leçon
// (abandon cumulatif) et génère une suggestion actionnable sur le pire point
// de chute. Consommée par la page analytics (P61 étendue).

/** Leçon du plan de cours, positionnée (numérotation « section.position »). */
export interface HeatmapLessonRef {
  lessonId: string;
  /** Ordre de la section (0-based) — sert à numéroter "3.2". */
  sectionOrder: number;
  /** Ordre de la leçon dans sa section (0-based). */
  lessonOrder: number;
  title: string;
}

/** Ligne de progression minimale nécessaire au calcul (une par apprenant × leçon complétée). */
export interface HeatmapProgressRow {
  studentId: string;
  lessonId: string;
  completedAt?: Date | string | null;
}

export interface DropoutHeatmapPoint {
  lessonId: string;
  title: string;
  /** Libellé "section.leçon" en 1-based (ex. "3.2"). */
  label: string;
  /** Nombre d'apprenants ayant complété cette leçon. */
  completedCount: number;
  /** % (0-100) des inscrits qui ONT complété cette leçon. */
  completionRate: number;
  /** % (0-100) des inscrits qui abandonnent AVANT ou À cette leçon (n'ont pas complété). */
  dropoutRate: number;
}

export interface DropoutHeatmapResult {
  points: DropoutHeatmapPoint[];
  /** Point avec le plus fort taux d'abandon, ou null si aucune leçon. */
  worstPoint: DropoutHeatmapPoint | null;
  /** Suggestion textuelle actionnable basée sur worstPoint (vide si non pertinent). */
  suggestion: string;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Calcule le taux de complétion/abandon par leçon. `totalEnrolled` est le
 * nombre total d'apprenants inscrits au cours (dénominateur commun) ; les
 * leçons sont triées par (sectionOrder, lessonOrder) pour respecter le plan
 * de cours. Seuil de suggestion : dropoutRate >= 40% déclenche une alerte.
 */
export function computeDropoutHeatmap(
  lessons: readonly HeatmapLessonRef[],
  progress: readonly HeatmapProgressRow[],
  totalEnrolled: number,
): DropoutHeatmapResult {
  const sorted = [...lessons].sort((a, b) =>
    a.sectionOrder !== b.sectionOrder ? a.sectionOrder - b.sectionOrder : a.lessonOrder - b.lessonOrder,
  );

  // Complétions distinctes par leçon (un apprenant ne compte qu'une fois).
  const completedByLesson = new Map<string, Set<string>>();
  for (const row of progress) {
    if (!row.completedAt) continue;
    const set = completedByLesson.get(row.lessonId) ?? new Set<string>();
    set.add(row.studentId);
    completedByLesson.set(row.lessonId, set);
  }

  const denom = Math.max(0, totalEnrolled);
  const points: DropoutHeatmapPoint[] = sorted.map((lesson) => {
    const completedCount = completedByLesson.get(lesson.lessonId)?.size ?? 0;
    const completionRate = denom > 0 ? round1((completedCount / denom) * 100) : 0;
    const dropoutRate = denom > 0 ? round1(100 - completionRate) : 0;
    return {
      lessonId: lesson.lessonId,
      title: lesson.title,
      label: `${lesson.sectionOrder + 1}.${lesson.lessonOrder + 1}`,
      completedCount,
      completionRate,
      dropoutRate,
    };
  });

  let worstPoint: DropoutHeatmapPoint | null = null;
  for (const p of points) {
    if (!worstPoint || p.dropoutRate > worstPoint.dropoutRate) worstPoint = p;
  }

  const SUGGESTION_THRESHOLD = 40;
  const suggestion =
    worstPoint && denom > 0 && worstPoint.dropoutRate >= SUGGESTION_THRESHOLD
      ? `${worstPoint.dropoutRate}% abandonnent à la leçon ${worstPoint.label} (${worstPoint.title}) → envisager une régénération.`
      : '';

  return { points, worstPoint, suggestion };
}
