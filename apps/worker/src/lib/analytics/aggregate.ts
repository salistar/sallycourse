// Logique PURE d'agrégation multi-plateformes (Prompt 61) — testable hors-ligne.
//
// Deux volets :
//  1) Génération MOCK déterministe : des métriques fictives mais plausibles,
//     stables pour un couple (courseId, platform) — mêmes entrées → mêmes
//     sorties, sans aléa ni réseau.
//  2) Agrégation : consolide les métriques de plusieurs plateformes en totaux
//     (inscrits, vues, revenu) et note moyenne pondérée par les inscrits.

import type { PlatformMetrics } from './types.js';

/* ------------------------------------------------------------------ */
/* MOCK déterministe                                                   */
/* ------------------------------------------------------------------ */

/**
 * Hash déterministe 32 bits (FNV-1a) d'une chaîne. Sert de graine aux
 * métriques mock : stable, sans dépendance, réparti uniformément.
 */
export function seedFromString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // Multiplication FNV (32 bits) via décalages pour rester en entier.
    h = Math.imul(h, 0x01000193);
  }
  // Force un entier non signé sur 32 bits.
  return h >>> 0;
}

/** Entier pseudo-aléatoire déterministe dans [min, max] à partir d'une graine. */
function seededInt(seed: number, salt: number, min: number, max: number): number {
  const mixed = Math.imul(seed ^ salt, 0x27d4eb2d) >>> 0;
  const span = max - min + 1;
  return min + (mixed % span);
}

/**
 * Métriques MOCK plausibles et déterministes pour un couple (courseId,
 * platform). Le profil dépend de la plateforme : Udemy pousse les inscrits et
 * le revenu, YouTube pousse les vues (revenu marginal, pas d'inscrits).
 */
export function mockMetrics(platform: string, courseId: string): PlatformMetrics {
  const seed = seedFromString(`${platform}:${courseId}`);

  if (platform === 'youtube') {
    const views = seededInt(seed, 1, 500, 40_000);
    // ~2 % des vues « likées » → note dérivée dans [3.5, 5].
    const rating = 3.5 + (seededInt(seed, 2, 0, 150) / 100);
    const revenue = Math.round((views / 1000) * 2.5 * 100) / 100; // ~2,5 $ CPM
    return { platform, enrollments: 0, rating, revenue, views, simulated: true };
  }

  // Udemy (défaut) : inscrits, note, revenu = inscrits × prix net moyen.
  const enrollments = seededInt(seed, 1, 5, 3_000);
  const rating = 3.8 + (seededInt(seed, 2, 0, 120) / 100); // [3.8, 5.0]
  const netPerSale = 9 + seededInt(seed, 3, 0, 6); // 9–15 $ net/vente
  const revenue = Math.round(enrollments * netPerSale * 100) / 100;
  return { platform, enrollments, rating, revenue, views: 0, simulated: true };
}

/* ------------------------------------------------------------------ */
/* Agrégation multi-plateformes                                        */
/* ------------------------------------------------------------------ */

export interface AggregatedAnalytics {
  totalEnrollments: number;
  totalViews: number;
  totalRevenue: number;
  /**
   * Note moyenne pondérée par les inscrits (0 si aucune plateforme notée).
   * Une plateforme notée mais sans inscrits (YouTube) compte avec un poids
   * plancher de 1 pour ne pas être exclue de la moyenne.
   */
  averageRating: number;
  /** Nombre de plateformes contribuant à l'agrégat. */
  platformCount: number;
}

/** Arrondi monétaire/décimal à 2 chiffres, robuste aux erreurs flottantes. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Agrège les métriques de plusieurs plateformes pour un cours. La note moyenne
 * est pondérée par les inscrits (poids plancher 1 si notée sans inscrit) afin
 * qu'un gros catalogue Udemy pèse davantage qu'une petite chaîne YouTube tout
 * en gardant cette dernière représentée.
 */
export function aggregateAnalytics(metrics: readonly PlatformMetrics[]): AggregatedAnalytics {
  let totalEnrollments = 0;
  let totalViews = 0;
  let totalRevenue = 0;
  let ratingWeightedSum = 0;
  let ratingWeight = 0;

  for (const m of metrics) {
    totalEnrollments += m.enrollments;
    totalViews += m.views;
    totalRevenue += m.revenue;
    if (m.rating > 0) {
      const weight = m.enrollments > 0 ? m.enrollments : 1;
      ratingWeightedSum += m.rating * weight;
      ratingWeight += weight;
    }
  }

  return {
    totalEnrollments,
    totalViews,
    totalRevenue: round2(totalRevenue),
    averageRating: ratingWeight > 0 ? round2(ratingWeightedSum / ratingWeight) : 0,
    platformCount: metrics.length,
  };
}
