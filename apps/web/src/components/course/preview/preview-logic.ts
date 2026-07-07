/**
 * Logique PURE de la prévisualisation étudiante (Prompt 60) : navigation
 * séquentielle entre leçons, calcul de progression locale et notation d'un quiz.
 * Aucune I/O — testable hors réseau/DB (vitest). L'UI (student-preview.tsx)
 * consomme ces helpers pour rester déclarative.
 */

export interface PreviewLessonLite {
  id: string;
  /** Une leçon quiz n'est « complétable » qu'après soumission du quiz. */
  type: 'video' | 'article' | 'tp' | 'quiz';
}

/** Index de la leçon suivante (borné) ou null s'il s'agit de la dernière. */
export function nextLessonIndex(current: number, total: number): number | null {
  if (total <= 0) return null;
  const bounded = Math.max(0, Math.min(current, total - 1));
  return bounded + 1 < total ? bounded + 1 : null;
}

/** Index de la leçon précédente (borné) ou null s'il s'agit de la première. */
export function prevLessonIndex(current: number, total: number): number | null {
  if (total <= 0) return null;
  const bounded = Math.max(0, Math.min(current, total - 1));
  return bounded - 1 >= 0 ? bounded - 1 : null;
}

/** Pourcentage (0–100, arrondi) de leçons complétées sur le total. */
export function previewProgressPercent(completedCount: number, total: number): number {
  if (total <= 0) return 0;
  const pct = Math.round((Math.min(completedCount, total) / total) * 100);
  return Math.max(0, Math.min(100, pct));
}

/** Cours parcouru en entier ? true quand toutes les leçons (>0) sont vues. */
export function isPreviewFinished(completedCount: number, total: number): boolean {
  return total > 0 && completedCount >= total;
}

export interface QuizGrade {
  /** Nombre de bonnes réponses. */
  correct: number;
  /** Nombre total de questions notées. */
  total: number;
  /** Pourcentage (0–100, arrondi). */
  percent: number;
  /** true si le seuil de réussite (par défaut 70 %) est atteint. */
  passed: boolean;
}

/**
 * Note un quiz à partir des réponses de l'étudiant. `answers[i]` est l'index du
 * choix sélectionné pour la question i (ou null/undefined si non répondue —
 * comptée fausse). PURE : ne révèle rien, calcule seulement le score.
 */
export function gradeQuiz(
  correctIndexes: readonly number[],
  answers: readonly (number | null | undefined)[],
  passThreshold = 70,
): QuizGrade {
  const total = correctIndexes.length;
  let correct = 0;
  for (let i = 0; i < total; i += 1) {
    if (answers[i] != null && answers[i] === correctIndexes[i]) correct += 1;
  }
  const percent = total > 0 ? Math.round((correct / total) * 100) : 0;
  return { correct, total, percent, passed: total > 0 && percent >= passThreshold };
}

/** Toutes les questions ont-elles reçu une réponse ? (active la soumission). */
export function allAnswered(
  total: number,
  answers: readonly (number | null | undefined)[],
): boolean {
  if (total <= 0) return false;
  for (let i = 0; i < total; i += 1) {
    if (answers[i] == null) return false;
  }
  return true;
}
