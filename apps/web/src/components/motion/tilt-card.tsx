'use client';

/**
 * TiltCard — inclinaison 3D subtile (±2° par défaut) qui suit le pointeur.
 * Communique l'interactivité d'une carte sans la déformer : l'effet reste
 * sous le seuil du « gadget » grâce à l'amplitude minime et au ressort doux.
 *
 * Désactivé automatiquement en `prefers-reduced-motion` (mouvement
 * vestibulaire) — la carte reste alors parfaitement statique.
 */

import * as React from 'react';
import { motion, useSpring } from 'framer-motion';
import { cn } from '@/lib/cn';
import { usePrefersReducedMotion } from './motion-config';

// Piège récurrent framer-motion × React 19 : les handlers de drag/animation
// HTML entrent en conflit de types avec ceux de motion.div — on les omet.
type TiltCardDivProps = Omit<
  React.HTMLAttributes<HTMLDivElement>,
  'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'
>;

export interface TiltCardProps extends TiltCardDivProps {
  /** Inclinaison maximale en degrés (défaut : 2 — rester subtil). */
  maxTilt?: number;
  children?: React.ReactNode;
}

export function TiltCard({ maxTilt = 2, className, children, ...props }: TiltCardProps) {
  const prefersReducedMotion = usePrefersReducedMotion();

  // Ressorts doux : l'inclinaison « rattrape » le pointeur sans à-coups.
  const rotateX = useSpring(0, { stiffness: 260, damping: 24, mass: 0.6 });
  const rotateY = useSpring(0, { stiffness: 260, damping: 24, mass: 0.6 });

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (prefersReducedMotion || event.pointerType === 'touch') return;
    const rect = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width - 0.5; // -0.5 → 0.5
    const py = (event.clientY - rect.top) / rect.height - 0.5;
    // Le bord survolé « vient » vers l'utilisateur.
    rotateX.set(-py * 2 * maxTilt);
    rotateY.set(px * 2 * maxTilt);
  };

  const resetTilt = () => {
    rotateX.set(0);
    rotateY.set(0);
  };

  return (
    <motion.div
      className={cn('[transform-style:preserve-3d] will-change-transform', className)}
      style={{ rotateX, rotateY, transformPerspective: 900 }}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetTilt}
      onPointerCancel={resetTilt}
      {...props}
    >
      {children}
    </motion.div>
  );
}
