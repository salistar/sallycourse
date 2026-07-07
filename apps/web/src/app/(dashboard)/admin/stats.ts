import type { CourseStatus, PlanId } from '@sallycourse/shared';

/**
 * Fonctions PURES de calcul de statistiques admin (P57).
 *
 * Elles prennent en entrée les résultats bruts d'agrégations Mongo ($group,
 * $count…) et en dérivent les indicateurs affichés. Isolées de Mongoose pour
 * être testables sans base : les pages serveur font les requêtes puis passent
 * les tableaux ici.
 */

/** Ligne d'un $group par jour : { _id: 'YYYY-MM-DD', count } (déjà projeté). */
export interface DailyBucket {
  day: string;
  count: number;
}

/** Ligne d'un $group par statut de déploiement. */
export interface StatusBucket {
  status: string;
  count: number;
}

/** Ligne d'un $group par plateforme cible. */
export interface PlatformBucket {
  platform: string;
  count: number;
}

/** Ligne d'un $group par plan utilisateur. */
export interface PlanBucket {
  plan: string;
  count: number;
}

/**
 * Complète une série journalière : garantit un point par jour sur `days`
 * jours glissants finissant à `end` (défaut aujourd'hui), les jours absents
 * de l'agrégation valant 0. Ordre chronologique croissant.
 */
export function fillDailySeries(
  buckets: DailyBucket[],
  days: number,
  end: Date = new Date(),
): DailyBucket[] {
  const byDay = new Map(buckets.map((b) => [b.day, b.count]));
  const series: DailyBucket[] = [];
  // On repart de `end` et on recule ; UTC pour rester cohérent avec $dateToString.
  const cursor = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(cursor);
    d.setUTCDate(cursor.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    series.push({ day: key, count: byDay.get(key) ?? 0 });
  }
  return series;
}

/** Somme des cours générés sur une série journalière. */
export function sumDaily(buckets: DailyBucket[]): number {
  return buckets.reduce((acc, b) => acc + b.count, 0);
}

/** Moyenne par jour (arrondie à 1 décimale) sur `days` jours. */
export function averagePerDay(buckets: DailyBucket[], days: number): number {
  if (days <= 0) return 0;
  return Math.round((sumDaily(buckets) / days) * 10) / 10;
}

/**
 * Taux d'approbation Udemy : part des déploiements Udemy « publiés » parmi
 * ceux ayant atteint un état terminal (published | failed). Les déploiements
 * encore en cours ne comptent pas au dénominateur. Retourne un ratio 0-1 et
 * les effectifs bruts ; `rate` vaut null si aucun terminal (pas d'info).
 */
export interface ApprovalStats {
  published: number;
  failed: number;
  terminal: number;
  /** Ratio 0-1 ou null si aucun déploiement terminal. */
  rate: number | null;
}

export function approvalStats(buckets: StatusBucket[]): ApprovalStats {
  const byStatus = new Map(buckets.map((b) => [b.status, b.count]));
  const published = byStatus.get('published') ?? 0;
  const failed = byStatus.get('failed') ?? 0;
  const terminal = published + failed;
  return {
    published,
    failed,
    terminal,
    rate: terminal === 0 ? null : published / terminal,
  };
}

/** Formatte un ratio 0-1 en pourcentage entier (« 87 % »), « — » si null. */
export function formatRate(rate: number | null): string {
  if (rate == null) return '—';
  return `${Math.round(rate * 100)} %`;
}

/**
 * Plateforme la plus utilisée : bucket de plus fort effectif. Départage
 * alphabétique en cas d'égalité (déterminisme des tests). null si vide.
 */
export function topPlatform(buckets: PlatformBucket[]): PlatformBucket | null {
  let best: PlatformBucket | null = null;
  for (const b of buckets) {
    if (
      best === null ||
      b.count > best.count ||
      (b.count === best.count && b.platform < best.platform)
    ) {
      best = b;
    }
  }
  return best;
}

/**
 * Répartition des plateformes en parts (0-1), triée par effectif décroissant.
 * Utile pour une barre empilée / une liste ordonnée.
 */
export interface PlatformShare extends PlatformBucket {
  share: number;
}

export function platformShares(buckets: PlatformBucket[]): PlatformShare[] {
  const total = buckets.reduce((acc, b) => acc + b.count, 0);
  return buckets
    .map((b) => ({ ...b, share: total === 0 ? 0 : b.count / total }))
    .sort((a, b) => b.count - a.count || a.platform.localeCompare(b.platform));
}

/**
 * Normalise une répartition par statut de cours sur l'ensemble des statuts
 * connus (les absents à 0), triée selon l'ordre canonique fourni.
 */
export function courseStatusBreakdown(
  buckets: StatusBucket[],
  order: readonly CourseStatus[],
): { status: CourseStatus; count: number }[] {
  const byStatus = new Map(buckets.map((b) => [b.status, b.count]));
  return order.map((status) => ({ status, count: byStatus.get(status) ?? 0 }));
}

/**
 * Normalise une répartition par plan sur l'ensemble des plans connus (absents
 * à 0), dans l'ordre fourni. Sert au panneau « utilisateurs par plan ».
 */
export function planBreakdown(
  buckets: PlanBucket[],
  order: readonly PlanId[],
): { plan: PlanId; count: number }[] {
  const byPlan = new Map(buckets.map((b) => [b.plan, b.count]));
  return order.map((plan) => ({ plan, count: byPlan.get(plan) ?? 0 }));
}

/**
 * Coût d'infrastructure estimé d'un cours généré (USD). Estimation grossière
 * pour la vue admin : appels LLM + TTS + rendu vidéo. Constante isolée pour
 * être ajustable et testable — pas une facturation réelle.
 */
export const ESTIMATED_COST_PER_COURSE_USD = 2.4;

/** Coût estimé pour un nombre de cours générés. */
export function estimatedCost(courseCount: number): number {
  if (courseCount <= 0) return 0;
  return Math.round(courseCount * ESTIMATED_COST_PER_COURSE_USD * 100) / 100;
}

/** Formatte un coût USD estimé (« $12.00 »). */
export function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

/** Usage relatif d'un plan borné : ratio 0-1, null si quota infini. */
export function planUsageRatio(used: number, limit: number): number | null {
  if (!Number.isFinite(limit)) return null;
  if (limit <= 0) return null;
  return Math.min(1, Math.max(0, used / limit));
}
