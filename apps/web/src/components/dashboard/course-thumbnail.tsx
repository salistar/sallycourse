import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * Miniature générée — placeholder SVG géométrique DÉTERMINISTE, seedé par le
 * titre du cours : même titre → même composition (stable entre SSR et client).
 * Toutes les couleurs passent par des classes de tokens (aucun hex inline).
 */

/** Hachage FNV-1a 32 bits — rapide, stable, suffisant pour un seed visuel. */
function hashTitle(title: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < title.length; i += 1) {
    hash ^= title.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** PRNG mulberry32 — séquence pseudo-aléatoire reproductible depuis le seed. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Palettes de classes (fonds violets profonds, formes violet/or). */
const PALETTES = [
  {
    bg: 'fill-primary-950',
    shapeA: 'fill-primary-600/50',
    shapeB: 'fill-accent-400/60',
    line: 'stroke-primary-300/40',
    spark: 'stroke-accent-300',
  },
  {
    bg: 'fill-neutral-950',
    shapeA: 'fill-primary-500/40',
    shapeB: 'fill-accent-500/50',
    line: 'stroke-accent-400/30',
    spark: 'stroke-primary-300',
  },
  {
    bg: 'fill-primary-900',
    shapeA: 'fill-primary-400/35',
    shapeB: 'fill-accent-400/45',
    line: 'stroke-primary-200/30',
    spark: 'stroke-accent-200',
  },
] as const;

type Palette = (typeof PALETTES)[number];

/** Motif « orbites » — cercles concentriques et satellites. */
function OrbitsMotif({ rnd, palette }: { rnd: () => number; palette: Palette }) {
  const cx = 60 + rnd() * 80;
  const cy = 40 + rnd() * 30;
  return (
    <g>
      <circle cx={cx} cy={cy} r={46} className={palette.line} strokeWidth="1" strokeDasharray="3 5" fill="none" />
      <circle cx={cx} cy={cy} r={28} className={palette.shapeA} />
      <circle cx={cx} cy={cy} r={13} className={palette.shapeB} />
      <circle cx={cx + 46} cy={cy} r={4.5} className={palette.shapeB} />
      <circle cx={cx - 30} cy={cy - 34} r={3} className={palette.shapeA} />
    </g>
  );
}

/** Motif « sommets » — triangles superposés façon montagne de données. */
function PeaksMotif({ rnd, palette }: { rnd: () => number; palette: Palette }) {
  const base = 96 + rnd() * 10;
  const x1 = 20 + rnd() * 30;
  const x2 = x1 + 46 + rnd() * 24;
  return (
    <g>
      <path d={`M${x1} ${base} l30 -52 l30 52 z`} className={palette.shapeA} />
      <path d={`M${x2} ${base} l24 -38 l24 38 z`} className={palette.shapeB} />
      <path d={`M12 ${base} H188`} className={palette.line} strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <circle cx={x1 + 30} cy={base - 66} r={5} className={palette.shapeB} />
    </g>
  );
}

/** Motif « losanges » — grille de diamants pivotés, signature SALISTAR. */
function DiamondsMotif({ rnd, palette }: { rnd: () => number; palette: Palette }) {
  const ox = 46 + rnd() * 60;
  const oy = 34 + rnd() * 18;
  return (
    <g>
      <rect x={ox} y={oy} width="42" height="42" rx="8" transform={`rotate(45 ${ox + 21} ${oy + 21})`} className={palette.shapeA} />
      <rect x={ox + 14} y={oy + 14} width="14" height="14" rx="4" transform={`rotate(45 ${ox + 21} ${oy + 21})`} className={palette.shapeB} />
      <rect x={ox + 58} y={oy + 26} width="20" height="20" rx="5" transform={`rotate(45 ${ox + 68} ${oy + 36})`} className={palette.shapeB} />
      <path d={`M${ox - 24} ${oy + 54} h14 M${ox - 17} ${oy + 47} v14`} className={palette.spark} strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </g>
  );
}

/** Motif « vagues » — courbes empilées, rythme d'un flux de génération. */
function WavesMotif({ rnd, palette }: { rnd: () => number; palette: Palette }) {
  const y = 58 + rnd() * 18;
  return (
    <g>
      <path d={`M0 ${y} C 40 ${y - 28}, 80 ${y + 22}, 120 ${y - 6} S 200 ${y - 20}, 200 ${y - 20} V 112 H 0 Z`} className={palette.shapeA} />
      <path d={`M0 ${y + 22} C 50 ${y - 4}, 100 ${y + 38}, 150 ${y + 10} S 200 ${y + 4}, 200 ${y + 4} V 112 H 0 Z`} className={palette.shapeB} />
      <path d={`M0 ${y - 24} C 40 ${y - 46}, 90 ${y - 6}, 140 ${y - 30}`} className={palette.line} strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <circle cx={160 + rnd() * 20} cy={y - 38} r={4} className={palette.shapeB} />
    </g>
  );
}

const MOTIFS = [OrbitsMotif, PeaksMotif, DiamondsMotif, WavesMotif] as const;

export interface CourseThumbnailProps {
  /** Titre du cours — sert de seed visuel. */
  title: string;
  className?: string;
}

export function CourseThumbnail({ title, className }: CourseThumbnailProps) {
  const seed = hashTitle(title);
  const rnd = mulberry32(seed);
  const palette = PALETTES[seed % PALETTES.length]!;
  const Motif = MOTIFS[(seed >>> 8) % MOTIFS.length]!;

  return (
    <svg
      viewBox="0 0 200 112"
      role="img"
      aria-label={`Miniature générée pour « ${title} »`}
      className={cn('block h-full w-full', className)}
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid slice"
    >
      <rect width="200" height="112" className={palette.bg} />
      <Motif rnd={rnd} palette={palette} />
      {/* Voile bas — assoit les badges posés en overlay */}
      <rect width="200" height="112" className="fill-neutral-950/20" />
    </svg>
  );
}
