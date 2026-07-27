// Phase 10 (P172) — contraintes propres à chaque plateforme cible, appliquées
// DÈS LE PLAN : selon les plateformes cochées à la création, le générateur de
// plan reçoit leurs exigences (durées mini, projet de classe, déclaration IA…)
// pour produire un plan déjà conforme. Fonctions PURES (pas d'I/O), testables ;
// réutilisées par l'affichage UI (contraintes actives) et l'injection prompt.

export interface PlatformConstraint {
  /** Libellé lisible de la plateforme. */
  label: string;
  /** Règles à respecter (phrases courtes, injectées dans le prompt de plan). */
  rules: string[];
}

/** Table éditable des contraintes par plateforme (ids alignés sur targetPlatforms). */
export const PLATFORM_CONSTRAINTS: Record<string, PlatformConstraint> = {
  udemy: {
    label: 'Udemy',
    rules: [
      'au moins 30 minutes de vidéo au total et une progression pédagogique claire',
      "déclarer l'usage de l'IA (contenu généré)",
      'chaque section se termine par une évaluation',
    ],
  },
  youtube: {
    label: 'YouTube',
    rules: ['regrouper le contenu en vidéos d’au moins 10 minutes (éviter les micro-clips)'],
  },
  skillshare: {
    label: 'Skillshare',
    rules: ['inclure un PROJET de classe concret et réalisable que l’apprenant produit à la fin'],
  },
  coursera: {
    label: 'Coursera',
    rules: ['objectifs d’apprentissage mesurables par module', 'des évaluations notées à chaque étape'],
  },
  'linkedin-learning': {
    label: 'LinkedIn Learning',
    rules: ['format concis et professionnel', 'chapitres courts et directement actionnables'],
  },
};

/**
 * Rend un bloc de consignes listant les contraintes des plateformes cibles
 * ACTIVES (celles connues de la table). Vide si aucune plateforme ou aucune
 * connue — à APPENDRE au prompt de plan (comme renderGenerationDirectives).
 */
export function renderPlatformConstraints(platforms: readonly string[] | undefined | null): string {
  if (!platforms || platforms.length === 0) return '';
  const active = platforms.map((p) => PLATFORM_CONSTRAINTS[p]).filter((c): c is PlatformConstraint => Boolean(c));
  if (active.length === 0) return '';
  const lines = active.flatMap((c) => c.rules.map((r) => `${c.label} : ${r}.`));
  return `\n\nCONTRAINTES DES PLATEFORMES CIBLES (respecte-les DÈS le plan) :\n- ${lines.join('\n- ')}`;
}

/** Liste des contraintes actives (pour affichage UI « contraintes actives »). */
export function activePlatformConstraints(
  platforms: readonly string[] | undefined | null,
): { platform: string; label: string; rules: string[] }[] {
  if (!platforms) return [];
  return platforms
    .map((p) => (PLATFORM_CONSTRAINTS[p] ? { platform: p, ...PLATFORM_CONSTRAINTS[p]! } : null))
    .filter((x): x is { platform: string; label: string; rules: string[] } => Boolean(x));
}
