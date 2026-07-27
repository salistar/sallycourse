// Types du dashboard analytics (P61).

/** Métriques d'un cours sur une plateforme, prêtes à l'affichage. */
export interface PlatformRow {
  platform: string;
  /** Libellé humain (ex. « Udemy »). */
  label: string;
  enrollments: number;
  rating: number;
  revenue: number;
  views: number;
  /** ISO 8601 du dernier rafraîchissement, ou null si inconnu. */
  fetchedAt: string | null;
  /** true si les métriques sont SIMULÉES (aucun token API — badge dédié). */
  simulated?: boolean;
}

/** Libellés humains par plateforme. */
export const PLATFORM_LABELS: Record<string, string> = {
  udemy: 'Udemy',
  youtube: 'YouTube',
};
