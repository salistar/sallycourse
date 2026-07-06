import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * Grain photographique léger — texture générée en pur CSS/SVG
 * (feTurbulence en data-URI : aucune image externe, aucune couleur définie).
 * Réservé aux fonds sombres profonds : le grain doit se deviner, pas se voir.
 */
const GRAIN_DATA_URI =
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E` +
  `%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E` +
  `%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E` +
  `%3Crect width='100%25' height='100%25' filter='url(%23g)'/%3E%3C/svg%3E")`;

export interface GrainOverlayProps {
  className?: string;
  /** Intensité du grain (opacité 0–1). Rester ≤ 0.5 pour un rendu subtil. */
  intensity?: number;
}

/** Voile de grain à poser en overlay d'un conteneur `relative`. */
export function GrainOverlay({ className, intensity = 0.35 }: GrainOverlayProps) {
  return (
    <div
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0 mix-blend-overlay', className)}
      style={{ backgroundImage: GRAIN_DATA_URI, opacity: intensity }}
    />
  );
}
