/**
 * Résolution PURE de la config Umami (P157) — aucune dépendance React ici,
 * pour rester testable en isolation (vitest, pas de rendu DOM nécessaire).
 *
 * RGPD : Umami ne pose pas de cookie tiers et anonymise les visiteurs
 * (pas d'identifiant persistant) — aucune bannière de consentement requise
 * pour ce type de mesure d'audience. Le script reste no-op tant que
 * NEXT_PUBLIC_UMAMI_WEBSITE_ID n'est pas configuré : rien n'est jamais chargé
 * par défaut (dev, previews, self-host sans le profil `monitoring`).
 */

export interface UmamiConfig {
  /** URL du script officiel Umami (ex. https://umami.exemple.com/script.js). */
  src: string;
  /** UUID du site généré dans l'UI Umami après création. */
  websiteId: string;
}

/** Défaut cohérent avec le service `umami` du profil docker-compose `monitoring`. */
const DEFAULT_UMAMI_SRC = 'http://localhost:3002/script.js';

/**
 * Construit la config Umami à partir des variables d'environnement
 * NEXT_PUBLIC_* fournies, ou retourne `null` si le tracking n'est pas
 * configuré (cas par défaut — aucun script ne doit alors être injecté).
 */
export function resolveUmamiConfig(
  env: { NEXT_PUBLIC_UMAMI_SRC?: string; NEXT_PUBLIC_UMAMI_WEBSITE_ID?: string } = {
    NEXT_PUBLIC_UMAMI_SRC: process.env.NEXT_PUBLIC_UMAMI_SRC,
    NEXT_PUBLIC_UMAMI_WEBSITE_ID: process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID,
  },
): UmamiConfig | null {
  const websiteId = env.NEXT_PUBLIC_UMAMI_WEBSITE_ID?.trim();
  if (!websiteId) return null; // no-op : pas d'ID de site, pas de tracking.

  const src = env.NEXT_PUBLIC_UMAMI_SRC?.trim() || DEFAULT_UMAMI_SRC;
  return { src, websiteId };
}
