import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * Illustrations abstraites géométriques SALISTAR — formes de « flux »
 * évoquant la transformation prompt → cours. Composants réutilisables
 * (landing, empty states, onboarding). Aucune couleur hex : uniquement
 * des classes Tailwind (fill-/stroke-) et les CSS variables --sc-*.
 */

export interface IllustrationProps {
  className?: string;
  /** Libellé accessible ; omis = illustration décorative (aria-hidden). */
  title?: string;
}

/** Attributs d'accessibilité : image nommée ou purement décorative. */
function a11yProps(title?: string) {
  return title
    ? ({ role: 'img', 'aria-label': title } as const)
    : ({ 'aria-hidden': true } as const);
}

/**
 * Dégradé signature violet → or, piloté par les CSS variables sémantiques.
 * Réservé aux fins liserés et traits — jamais en aplat massif.
 */
function FluxGradient({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" className="[stop-color:rgb(var(--sc-primary))]" />
      <stop offset="0.6" className="[stop-color:rgb(var(--sc-ring))]" />
      <stop offset="1" className="[stop-color:rgb(var(--sc-accent))]" />
    </linearGradient>
  );
}

/** Étincelle à quatre branches concaves — motif récurrent de la marque. */
function Spark({
  cx,
  cy,
  r,
  className,
}: {
  cx: number;
  cy: number;
  r: number;
  className?: string;
}) {
  const q = r * 0.22;
  const d =
    `M ${cx} ${cy - r} Q ${cx + q} ${cy - q} ${cx + r} ${cy} ` +
    `Q ${cx + q} ${cy + q} ${cx} ${cy + r} ` +
    `Q ${cx - q} ${cy + q} ${cx - r} ${cy} ` +
    `Q ${cx - q} ${cy - q} ${cx} ${cy - r} Z`;
  return <path d={d} className={cn('fill-accent-400', className)} />;
}

/**
 * Étincelle autonome — ponctuation dorée (listes, jalons, célébrations).
 */
export function IllustrationEtincelle({ className, title }: IllustrationProps) {
  return (
    <svg
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...a11yProps(title)}
    >
      <circle cx="24" cy="24" r="18" className="fill-none stroke-primary-500/30" strokeWidth="1.5" />
      <Spark cx={24} cy={24} r={11} />
    </svg>
  );
}

/**
 * Flux prompt → cours : une étincelle (l'idée) se déploie en trois courants
 * qui se matérialisent en modules empilés (le cours produit).
 * Illustration héroïque — sections d'accueil, écrans de génération.
 */
export function IllustrationFluxCours({ className, title }: IllustrationProps) {
  const gradId = 'sc-flux-cours-grad';
  return (
    <svg
      viewBox="0 0 480 280"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...a11yProps(title)}
    >
      <defs>
        <FluxGradient id={gradId} />
      </defs>

      {/* L'idée : étincelle dorée cerclée de violet */}
      <circle cx="64" cy="140" r="30" className="fill-none stroke-primary-500/30" strokeWidth="1.5" />
      <circle cx="64" cy="140" r="18" className="fill-none stroke-primary-400/70" strokeWidth="1.5" />
      <Spark cx={64} cy={140} r={9} />

      {/* Trois courants de génération, en dégradé violet → or */}
      <g fill="none" stroke={`url(#${gradId})`} strokeWidth="1.5" strokeLinecap="round">
        <path d="M94 132 C170 70 240 62 322 82" opacity="0.9" />
        <path d="M96 140 C180 140 240 140 322 140" opacity="0.55" />
        <path d="M94 148 C170 210 240 218 322 198" opacity="0.9" />
      </g>

      {/* Nœuds de traitement le long des courants */}
      <circle cx="208" cy="101" r="3.5" className="fill-primary-400" />
      <circle cx="208" cy="140" r="3.5" className="fill-primary-400" />
      <circle cx="208" cy="179" r="3.5" className="fill-primary-400" />
      <circle cx="150" cy="112" r="2" className="fill-accent-400" />
      <circle cx="268" cy="122" r="2" className="fill-accent-400" />
      <circle cx="268" cy="170" r="2" className="fill-accent-400" />

      {/* Le cours : trois modules empilés */}
      {[60, 118, 176].map((y, index) => (
        <g key={y}>
          <rect
            x="322"
            y={y}
            width="118"
            height="44"
            rx="10"
            className="fill-primary-500/10 stroke-primary-400/60"
            strokeWidth="1.5"
          />
          <circle
            cx="344"
            cy={y + 22}
            r="6"
            className={cn('fill-none', index === 0 ? 'stroke-accent-400' : 'stroke-primary-400/70')}
            strokeWidth="1.5"
          />
          <path
            d={`M342 ${y + 19} L347.5 ${y + 22} L342 ${y + 25} Z`}
            className={index === 0 ? 'fill-accent-400' : 'fill-primary-400/70'}
          />
          <rect x="358" y={y + 14} width="60" height="4" rx="2" className="fill-neutral-400/50" />
          <rect x="358" y={y + 26} width="40" height="4" rx="2" className="fill-neutral-400/30" />
        </g>
      ))}
    </svg>
  );
}

/**
 * Constellation de savoirs : un graphe de notions reliées, dont le nœud
 * central (doré) figure le cours qui les rassemble.
 * Usage : dashboards, sections « bibliothèque », états vides riches.
 */
export function IllustrationConstellation({ className, title }: IllustrationProps) {
  const gradId = 'sc-constellation-grad';
  const nodes: Array<[number, number]> = [
    [66, 210],
    [118, 96],
    [258, 64],
    [238, 224],
  ];
  return (
    <svg
      viewBox="0 0 320 280"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...a11yProps(title)}
    >
      <defs>
        <FluxGradient id={gradId} />
      </defs>

      {/* Arêtes du graphe */}
      <g className="stroke-primary-500/35" strokeWidth="1.25">
        <line x1="66" y1="210" x2="118" y2="96" />
        <line x1="196" y1="150" x2="258" y2="64" />
        <line x1="196" y1="150" x2="238" y2="224" />
        <line x1="66" y1="210" x2="196" y2="150" />
        <line x1="118" y1="96" x2="258" y2="64" />
      </g>
      {/* Arête « vivante » en dégradé violet → or */}
      <line x1="118" y1="96" x2="196" y2="150" stroke={`url(#${gradId})`} strokeWidth="1.5" />

      {/* Notions */}
      {nodes.map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="5" className="fill-primary-400" />
      ))}

      {/* Le cours : nœud central doré et son halo */}
      <circle cx="196" cy="150" r="14" className="fill-none stroke-accent-400/40" strokeWidth="1.5" />
      <circle cx="196" cy="150" r="7" className="fill-accent-400" />

      {/* Poussière d'étoiles */}
      <circle cx="42" cy="72" r="2" className="fill-neutral-400/60" />
      <circle cx="284" cy="140" r="2" className="fill-neutral-400/60" />
      <circle cx="150" cy="252" r="2" className="fill-neutral-400/60" />
      <circle cx="96" cy="34" r="1.5" className="fill-neutral-400/40" />
      <circle cx="266" cy="252" r="1.5" className="fill-neutral-400/40" />
    </svg>
  );
}

/**
 * Strates de savoir : des couches isométriques traversées par un fil doré
 * qui s'élève vers une étincelle — la progression de l'apprenant.
 * Usage : pages de progression, paliers, gamification.
 */
export function IllustrationStrates({ className, title }: IllustrationProps) {
  const gradId = 'sc-strates-grad';
  const layer = (cy: number) =>
    `M160 ${cy - 40} L268 ${cy} L160 ${cy + 40} L52 ${cy} Z`;
  return (
    <svg
      viewBox="0 0 320 280"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...a11yProps(title)}
    >
      <defs>
        <FluxGradient id={gradId} />
      </defs>

      {/* Couches, de la base vers le sommet */}
      <path d={layer(196)} className="fill-primary-500/10 stroke-primary-500/45" strokeWidth="1.5" />
      <path d={layer(152)} className="fill-primary-500/10 stroke-primary-500/55" strokeWidth="1.5" />
      <path d={layer(108)} className="fill-primary-500/15" stroke={`url(#${gradId})`} strokeWidth="1.5" />

      {/* Fil de progression pointillé, en dégradé */}
      <path
        d="M160 236 C142 202 180 174 160 148 C144 126 172 106 160 70"
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="1 7"
      />

      {/* L'accomplissement */}
      <Spark cx={160} cy={54} r={10} />
      <circle cx="160" cy="54" r="17" className="fill-none stroke-accent-400/35" strokeWidth="1.5" />
    </svg>
  );
}
