import {
  claudeCostUsd,
  ttsCostUsd,
  renderCostUsd,
  imageCostUsd,
  planMargin,
  COURSE_COST_ALERT_USD,
  type CostKind,
  type PlanMargin,
} from '@sallycourse/shared';

/**
 * Fonctions PURES d'agrégation des coûts de génération (P55).
 *
 * Elles prennent des lignes CostRecord brutes (déjà projetées depuis Mongo) et
 * en dérivent : le coût par cours, la marge par plan (revenu − coût), et les
 * cours dépassant le seuil d'alerte. Isolées de Mongoose pour être testables
 * sans base — la page serveur fait les requêtes puis passe les tableaux ici.
 *
 * Les montants sont ré-estimés ici depuis la table de tarifs partagée : la
 * source de vérité reste pricing-table, et un changement de grille se reflète
 * sans migration de données (les métriques brutes tokens/chars/seconds sont
 * conservées sur chaque CostRecord).
 */

/** Ligne CostRecord projetée pour l'agrégation (métriques brutes + contexte). */
export interface CostRow {
  courseId: string;
  userId: string;
  kind: CostKind;
  tokensIn?: number | undefined;
  tokensOut?: number | undefined;
  chars?: number | undefined;
  seconds?: number | undefined;
  model?: string | undefined;
}

/** Coût USD d'une ligne, ré-estimé depuis la table de tarifs. */
export function rowCostUsd(row: CostRow): number {
  switch (row.kind) {
    case 'claude':
      return claudeCostUsd(row.model ?? 'claude-sonnet-5', row.tokensIn ?? 0, row.tokensOut ?? 0);
    case 'tts':
      return ttsCostUsd(row.chars ?? 0);
    case 'render':
      return renderCostUsd(row.seconds ?? 0);
    case 'image':
      return imageCostUsd(1);
    default:
      return 0;
  }
}

/** Ventilation d'un coût par nature (pour l'affichage détaillé). */
export type CostByKind = Record<CostKind, number>;

function emptyByKind(): CostByKind {
  return { claude: 0, tts: 0, render: 0, image: 0 };
}

/** Total agrégé d'un cours : coût global + ventilation par nature. */
export interface CourseCost {
  courseId: string;
  userId: string;
  totalUsd: number;
  byKind: CostByKind;
  /** Vrai si totalUsd dépasse le seuil d'alerte. */
  overThreshold: boolean;
}

/**
 * Agrège les lignes par cours. Retourne un tableau trié par coût décroissant
 * (les cours les plus chers d'abord) — pratique pour repérer les anomalies.
 */
export function costByCourse(
  rows: readonly CostRow[],
  alertThresholdUsd: number = COURSE_COST_ALERT_USD,
): CourseCost[] {
  const map = new Map<string, CourseCost>();
  for (const row of rows) {
    const usd = rowCostUsd(row);
    let entry = map.get(row.courseId);
    if (!entry) {
      entry = {
        courseId: row.courseId,
        userId: row.userId,
        totalUsd: 0,
        byKind: emptyByKind(),
        overThreshold: false,
      };
      map.set(row.courseId, entry);
    }
    entry.totalUsd += usd;
    entry.byKind[row.kind] += usd;
  }
  const list = [...map.values()];
  for (const c of list) {
    c.totalUsd = round(c.totalUsd);
    for (const k of Object.keys(c.byKind) as CostKind[]) c.byKind[k] = round(c.byKind[k]);
    c.overThreshold = c.totalUsd > alertThresholdUsd;
  }
  return list.sort((a, b) => b.totalUsd - a.totalUsd);
}

/** Coût total (USD) de toutes les lignes. */
export function totalCostUsd(rows: readonly CostRow[]): number {
  return round(rows.reduce((acc, r) => acc + rowCostUsd(r), 0));
}

/**
 * Marge par plan : revenu du plan (× nb d'utilisateurs actifs) − coût total des
 * cours de ce plan. `costByPlan` mappe planId → coût USD ; `activeUsersByPlan`
 * mappe planId → nb d'utilisateurs (pour agréger le revenu sur la base
 * installée). Un plan sans coût ni utilisateur est ignoré.
 */
export function marginByPlan(
  costByPlan: Record<string, number>,
  activeUsersByPlan: Record<string, number>,
): PlanMargin[] {
  const plans = new Set<string>([...Object.keys(costByPlan), ...Object.keys(activeUsersByPlan)]);
  const out: PlanMargin[] = [];
  for (const plan of plans) {
    const cost = round(costByPlan[plan] ?? 0);
    const users = activeUsersByPlan[plan] ?? 0;
    const m = planMargin(plan, cost, users);
    out.push({
      plan: m.plan,
      revenueUsd: round(m.revenueUsd),
      costUsd: round(m.costUsd),
      marginUsd: round(m.marginUsd),
    });
  }
  // Marge décroissante : les plans les plus rentables d'abord.
  return out.sort((a, b) => b.marginUsd - a.marginUsd);
}

/** Cours dépassant le seuil d'alerte (sous-ensemble de costByCourse). */
export function alertingCourses(
  courseCosts: readonly CourseCost[],
): CourseCost[] {
  return courseCosts.filter((c) => c.overThreshold);
}

/** Arrondi USD à 4 décimales (les micro-coûts token restent lisibles). */
function round(v: number): number {
  return Math.round(v * 10000) / 10000;
}
