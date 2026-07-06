import * as React from 'react';

/**
 * Illustrations géométriques des trois niveaux — SVG inline, aucune couleur
 * en dur : tout passe par les classes de tokens (fill-/stroke-).
 * Décoratives (aria-hidden posé par le parent via props).
 */
type IllustrationProps = React.SVGProps<SVGSVGElement>;

/** Débutant — « la graine » : cercle-terreau, pousse et point d'or qui s'élève. */
export function BeginnerIllustration(props: IllustrationProps) {
  return (
    <svg viewBox="0 0 120 88" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      {/* Terreau : disque doux + orbite pointillée */}
      <circle cx="60" cy="56" r="24" className="fill-primary-soft" />
      <circle
        cx="60"
        cy="56"
        r="30"
        className="stroke-primary-500/50"
        strokeWidth="1.5"
        strokeDasharray="3 5"
      />
      {/* Tige qui émerge */}
      <path
        d="M60 62 V38"
        className="stroke-primary-400"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      {/* Deux feuilles géométriques */}
      <path d="M60 46 C52 44 48 38 49 31 C56 32 60 38 60 46 Z" className="fill-primary-400" />
      <path d="M60 52 C68 50 72 44 71 37 C64 38 60 44 60 52 Z" className="fill-primary-600" />
      {/* Point d'or : le potentiel qui s'élève */}
      <circle cx="60" cy="20" r="4" className="fill-accent-400" />
      {/* Fondations : trois points d'appui */}
      <circle cx="42" cy="80" r="2.5" className="fill-primary-700" />
      <circle cx="60" cy="82" r="2.5" className="fill-primary-500" />
      <circle cx="78" cy="80" r="2.5" className="fill-primary-700" />
    </svg>
  );
}

/** Intermédiaire — « l'ascension » : marches croissantes et trajectoire dorée. */
export function IntermediateIllustration(props: IllustrationProps) {
  return (
    <svg viewBox="0 0 120 88" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      {/* Marches de progression */}
      <rect x="18" y="58" width="16" height="22" rx="3" className="fill-primary-800" />
      <rect x="40" y="46" width="16" height="34" rx="3" className="fill-primary-600" />
      <rect x="62" y="34" width="16" height="46" rx="3" className="fill-primary-500" />
      <rect x="84" y="20" width="16" height="60" rx="3" className="fill-primary-400" />
      {/* Trajectoire dorée en pointillés au-dessus des marches */}
      <path
        d="M20 50 L46 38 L68 26 L90 12"
        className="stroke-accent-400"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="1 6"
      />
      {/* Jalon d'or atteint */}
      <circle cx="90" cy="12" r="4" className="fill-accent-400" />
      <circle cx="46" cy="38" r="2.5" className="fill-accent-500/70" />
      {/* Ligne de sol */}
      <path d="M14 82 H106" className="stroke-border" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Avancé — « le sommet » : massif à deux pics et éclat d'or au point culminant. */
export function AdvancedIllustration(props: IllustrationProps) {
  return (
    <svg viewBox="0 0 120 88" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      {/* Massif arrière */}
      <path d="M30 82 L62 26 L94 82 Z" className="fill-primary-800" />
      {/* Massif avant, décalé */}
      <path d="M14 82 L44 38 L74 82 Z" className="fill-primary-600" />
      {/* Arête éclairée du pic principal */}
      <path
        d="M62 26 L76 50"
        className="stroke-primary-300"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Éclat d'or à quatre branches au sommet */}
      <path
        d="M62 4 L64.5 12.5 L73 15 L64.5 17.5 L62 26 L59.5 17.5 L51 15 L59.5 12.5 Z"
        className="fill-accent-400"
      />
      {/* Étoiles secondaires */}
      <circle cx="88" cy="24" r="2" className="fill-accent-300" />
      <circle cx="26" cy="30" r="1.5" className="fill-accent-500/80" />
      {/* Ligne de sol */}
      <path d="M10 82 H110" className="stroke-border" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
