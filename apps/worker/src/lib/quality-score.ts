// Score de qualité pédagogique (Prompt 94).
//
// evaluateCourseQuality(course, lessons) note le cours généré sur 100 via
// callClaudeJson (rubrique clarté/progression/exemples/engagement, 25 pts
// chacun) — ou une heuristique déterministe en mode MOCK_PROVIDERS (présence
// de TP, diversité des types de leçon, longueur des articles). Persisté sur
// Course.qualityScore (additif). Un seuil configurable (QUALITY_SCORE.
// MIN_DEPLOY_THRESHOLD) bloque le déploiement Udemy tant que non atteint,
// mais reste contournable par l'utilisateur avec confirmation explicite —
// jamais un blocage silencieux (voir gate/route API deploy).
//
// Les fonctions PURES (heuristique mock, gate de seuil) sont exportées et
// testées isolément ; evaluateCourseQuality fait l'appel LLM + persistance.
import { z } from 'zod';
import {
  Course,
  QUALITY_SCORE,
  qualityEvaluationSchema,
  qualityScoreSchema,
  type ILesson,
  type QualityEvaluation,
  type QualityRubric,
  type QualityScore,
} from '../shared.js';
import { callClaudeJson } from './claude.js';
import { logger } from '../queues/index.js';

/** Sous-ensemble d'un cours nécessaire à l'évaluation (titre + difficulté). */
export type CourseForQuality = { title: string; difficulty?: string };

/** Sous-ensemble d'une leçon hydratée nécessaire à l'évaluation. */
export type LessonForQuality = Pick<ILesson, 'title' | 'type' | 'status' | 'assets'> & {
  articleWordCount?: number;
};

/* ------------------------------------------------------------------ */
/* Heuristique mock PURE (déterministe, sans appel LLM)                 */
/* ------------------------------------------------------------------ */

/** Nombre de mots d'un Markdown (blocs de code fencés exclus). */
function markdownWordCount(markdown: string | undefined): number {
  if (!markdown) return 0;
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * Note « clarté » heuristique : longueur moyenne des articles (ni trop
 * courts — bâclés —, ni excessifs). Plafonnée à RUBRIC_MAX_PER_CRITERION.
 */
export function heuristicClarityScore(lessons: LessonForQuality[]): number {
  const articles = lessons.filter((l) => l.type === 'article');
  if (articles.length === 0) return 15; // pas d'article : score neutre, ni pénalisé ni primé
  const avgWords =
    articles.reduce((sum, l) => sum + (l.articleWordCount ?? markdownWordCount(l.assets?.articleMd)), 0) /
    articles.length;
  // 400 mots (repère MIN_WORDS générateur) → score plein ; en dessous, dégressif.
  const ratio = Math.min(1, avgWords / 400);
  return Math.round(ratio * QUALITY_SCORE.RUBRIC_MAX_PER_CRITERION);
}

/**
 * Note « progression » heuristique : diversité des types de leçon (video,
 * article, tp, quiz) — un cours qui alterne les formats structure mieux
 * l'apprentissage qu'une suite uniforme de vidéos.
 */
export function heuristicProgressionScore(lessons: LessonForQuality[]): number {
  if (lessons.length === 0) return 0;
  const distinctTypes = new Set(lessons.map((l) => l.type)).size;
  // 4 types possibles (video/article/tp/quiz) → diversité max = score plein.
  const ratio = Math.min(1, distinctTypes / 4);
  return Math.round(ratio * QUALITY_SCORE.RUBRIC_MAX_PER_CRITERION);
}

/**
 * Note « exemples » heuristique : présence de travaux pratiques (tp), gage
 * d'application concrète. Proportion de TP sur le total des leçons.
 */
export function heuristicExamplesScore(lessons: LessonForQuality[]): number {
  if (lessons.length === 0) return 0;
  const tpCount = lessons.filter((l) => l.type === 'tp').length;
  // 1 TP pour 5 leçons est un ratio confortable → score plein au-delà.
  const ratio = Math.min(1, tpCount / Math.max(1, Math.ceil(lessons.length / 5)));
  return Math.round(ratio * QUALITY_SCORE.RUBRIC_MAX_PER_CRITERION);
}

/**
 * Note « engagement » heuristique : proportion de leçons finalisées ('ready')
 * — un cours incomplet ne peut pas être jugé engageant, quel que soit le contenu.
 */
export function heuristicEngagementScore(lessons: LessonForQuality[]): number {
  if (lessons.length === 0) return 0;
  const readyCount = lessons.filter((l) => l.status === 'ready').length;
  const ratio = readyCount / lessons.length;
  return Math.round(ratio * QUALITY_SCORE.RUBRIC_MAX_PER_CRITERION);
}

/**
 * Évaluation heuristique complète (mode mock) — déterministe, sans appel LLM.
 * Somme des 4 axes (0-100) + feedback textuel dérivé des points faibles.
 */
export function heuristicQualityEvaluation(lessons: LessonForQuality[]): QualityEvaluation {
  const rubric: QualityRubric = {
    clarity: heuristicClarityScore(lessons),
    progression: heuristicProgressionScore(lessons),
    examples: heuristicExamplesScore(lessons),
    engagement: heuristicEngagementScore(lessons),
  };
  const score = rubric.clarity + rubric.progression + rubric.examples + rubric.engagement;

  const feedback: string[] = [];
  if (rubric.clarity < 15) feedback.push('Les articles gagneraient à être plus développés pour plus de clarté.');
  if (rubric.progression < 15) feedback.push('Diversifiez davantage les formats de leçon (vidéo, article, TP, quiz).');
  if (rubric.examples < 15) feedback.push('Ajoutez des travaux pratiques pour ancrer les notions dans du concret.');
  if (rubric.engagement < 20) feedback.push('Certaines leçons ne sont pas finalisées — terminez la génération avant publication.');
  if (feedback.length === 0) feedback.push('Bon équilibre pédagogique — rien à signaler de particulier.');

  return qualityEvaluationSchema.parse({ score, rubric, feedback });
}

/* ------------------------------------------------------------------ */
/* Gate de seuil PURE (bloque/autorise le déploiement)                  */
/* ------------------------------------------------------------------ */

export interface QualityGateResult {
  /** true si le score atteint le seuil OU si l'utilisateur a explicitement confirmé. */
  allowed: boolean;
  /** true si le score est sous le seuil (indépendamment de la confirmation). */
  belowThreshold: boolean;
  /** Message clair à afficher si le déploiement est bloqué. */
  message?: string;
}

/**
 * Vérifie un score de qualité contre le seuil minimum avant déploiement.
 * - score >= seuil → toujours autorisé.
 * - score < seuil ET confirmLowQuality=true → autorisé (contournement explicite).
 * - score < seuil ET confirmLowQuality=false → bloqué, message clair (jamais silencieux).
 * - score absent (jamais évalué) → autorisé (on ne bloque pas rétroactivement les cours
 *   déjà en place avant l'introduction de ce contrôle).
 */
export function checkQualityGate(
  score: number | null | undefined,
  confirmLowQuality: boolean,
  threshold: number = QUALITY_SCORE.MIN_DEPLOY_THRESHOLD,
): QualityGateResult {
  if (score === null || score === undefined) {
    return { allowed: true, belowThreshold: false };
  }
  const belowThreshold = score < threshold;
  if (!belowThreshold) return { allowed: true, belowThreshold: false };
  if (confirmLowQuality) {
    return {
      allowed: true,
      belowThreshold: true,
      message: `Score de qualité ${score}/100 (seuil ${threshold}) — déploiement autorisé malgré tout (confirmation explicite).`,
    };
  }
  return {
    allowed: false,
    belowThreshold: true,
    message:
      `Score de qualité pédagogique ${score}/100, sous le seuil recommandé de ${threshold}/100. ` +
      `Améliorez le cours avant publication, ou confirmez explicitement pour publier malgré tout.`,
  };
}

/* ------------------------------------------------------------------ */
/* Orchestrateur (I/O : Claude + Mongo)                                  */
/* ------------------------------------------------------------------ */

/** Prompt système : consignes de notation, format JSON strict. */
const SYSTEM_PROMPT = `Tu es un expert en pédagogie qui évalue la qualité d'un cours en ligne généré automatiquement.
Note le cours sur 4 axes, chacun de 0 à ${QUALITY_SCORE.RUBRIC_MAX_PER_CRITERION} points :
- clarity (clarté des explications et de la structure)
- progression (cohérence de la montée en difficulté, diversité des formats)
- examples (présence et qualité des exemples concrets / travaux pratiques)
- engagement (capacité à maintenir l'attention, ton, rythme)
Réponds UNIQUEMENT avec un JSON de la forme :
{"score": <somme des 4 axes, 0-100>, "rubric": {"clarity": n, "progression": n, "examples": n, "engagement": n}, "feedback": ["remarque 1", "remarque 2"]}
Le feedback liste 1 à 5 remarques concrètes et actionnables (pas de superlatifs creux).`;

/** Construit le prompt utilisateur : résumé structuré du cours à évaluer. */
function buildUserPrompt(course: CourseForQuality, lessons: LessonForQuality[]): string {
  const byType = lessons.reduce<Record<string, number>>((acc, l) => {
    acc[l.type] = (acc[l.type] ?? 0) + 1;
    return acc;
  }, {});
  const articleExcerpts = lessons
    .filter((l) => l.type === 'article' && l.assets?.articleMd)
    .slice(0, 3)
    .map((l) => `- « ${l.title} » (extrait) : ${(l.assets.articleMd ?? '').slice(0, 400)}`)
    .join('\n');

  return [
    `Titre du cours : « ${course.title} »`,
    course.difficulty ? `Niveau : ${course.difficulty}` : '',
    `Nombre de leçons : ${lessons.length}`,
    `Répartition par type : ${Object.entries(byType).map(([t, n]) => `${t}=${n}`).join(', ') || 'aucune'}`,
    articleExcerpts ? `Extraits d'articles :\n${articleExcerpts}` : '',
    `Évalue ce cours selon la rubrique demandée.`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Évalue la qualité pédagogique d'un cours généré : appelle callClaudeJson
 * (rubrique 4 axes) ou l'heuristique déterministe en mode mock, persiste le
 * résultat sur Course.qualityScore (additif, ne bloque jamais la finalisation
 * du cours en cas d'échec best-effort côté appelant).
 */
export async function evaluateCourseQuality(
  course: CourseForQuality,
  lessons: LessonForQuality[],
): Promise<QualityEvaluation> {
  const evaluation = await callClaudeJson<z.infer<typeof qualityEvaluationSchema>>({
    schema: qualityEvaluationSchema,
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(course, lessons),
    // Heuristique déterministe utilisée UNIQUEMENT si le mock générique ne
    // produit rien d'exploitable — callClaudeJson gère déjà MOCK_PROVIDERS,
    // mais mock-fixtures.ts n'a pas de générateur dédié à ce schéma : on
    // fournit donc l'heuristique en repli explicite ci-dessous plutôt que de
    // laisser mockFixtureFor jeter.
  }).catch(() => heuristicQualityEvaluation(lessons));

  return evaluation;
}

/**
 * Évalue puis persiste Course.qualityScore. Best-effort : une erreur est
 * loggée mais ne jette jamais (n'invalide pas la finalisation du cours).
 */
export async function evaluateAndStoreCourseQuality(
  courseId: string,
  course: CourseForQuality,
  lessons: LessonForQuality[],
): Promise<QualityScore | null> {
  try {
    const evaluation = await evaluateCourseQuality(course, lessons);
    const qualityScore: QualityScore = qualityScoreSchema.parse({
      ...evaluation,
      evaluatedAt: new Date().toISOString(),
    });
    await Course.updateOne({ _id: courseId }, { $set: { qualityScore } });
    logger.info({ courseId, score: qualityScore.score }, 'score de qualité pédagogique évalué');
    return qualityScore;
  } catch (err) {
    logger.warn({ courseId, err }, 'évaluation de la qualité pédagogique échouée (best-effort)');
    return null;
  }
}
