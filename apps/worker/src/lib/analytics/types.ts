// Types partagés de l'analytics des cours publiés (Prompt 61).

/** Plateformes disposant d'un provider analytics. */
export const ANALYTICS_PLATFORMS = ['udemy', 'youtube'] as const;
export type AnalyticsPlatform = (typeof ANALYTICS_PLATFORMS)[number];

/**
 * Métriques normalisées renvoyées par un provider, quelle que soit la
 * plateforme. Un champ non applicable (ex. `views` sur Udemy) vaut 0.
 */
export interface PlatformMetrics {
  platform: string;
  /** Inscrits / acheteurs (Udemy). */
  enrollments: number;
  /** Note moyenne 0–5 (0 = non noté). */
  rating: number;
  /** Revenu cumulé en USD. */
  revenue: number;
  /** Vues (YouTube). */
  views: number;
  /** true si les métriques sont SIMULÉES (aucun token API — jamais des chiffres réels). */
  simulated?: boolean;
}

/** Contexte transmis à un provider pour récupérer les métriques d'un cours. */
export interface AnalyticsFetchContext {
  courseId: string;
  /** Identifiant du cours côté plateforme (issu du Deployment.externalId). */
  externalId?: string;
  /** URL publique du cours (facultatif — traçabilité). */
  externalUrl?: string;
}

/** Un provider analytics : récupère les métriques d'un cours pour sa plateforme. */
export interface AnalyticsProvider {
  readonly platform: AnalyticsPlatform;
  fetchMetrics(ctx: AnalyticsFetchContext): Promise<PlatformMetrics>;
}
