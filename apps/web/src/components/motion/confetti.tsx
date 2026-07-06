'use client';

/**
 * Confetti — célébration discrète en canvas (fin d'une génération réussie).
 * Deux gerbes or/violet, gravité douce, disparition en fondu : l'effet
 * signe la réussite sans envahir l'écran.
 *
 * Les couleurs proviennent des tokens du design system (seule source
 * autorisée pour des valeurs hexadécimales) — un canvas ne peut pas
 * consommer de classes Tailwind.
 *
 * Respecte `prefers-reduced-motion` : aucun confetti, `onComplete` immédiat.
 */

import * as React from 'react';
import { colors, gold, violet } from '@sallycourse/design/tokens';
import { usePrefersReducedMotion } from './motion-config';

/** Palette de fête : ors chauds + violets de marque + éclats blancs. */
const CONFETTI_PALETTE: readonly string[] = [
  gold[200],
  gold[400],
  gold[500],
  violet[300],
  violet[400],
  violet[600],
  colors.white,
];

interface Particle {
  x: number;
  y: number;
  /** Vitesse (px/s). */
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  /** Vitesse angulaire (rad/s). */
  vr: number;
  color: string;
  shape: 'rect' | 'circle';
  /** Durée de vie totale (ms). */
  life: number;
}

export interface ConfettiProps {
  /** Passe à true pour déclencher la gerbe (front montant). */
  active: boolean;
  /** Appelé une fois la célébration terminée (ou immédiatement en motion réduit). */
  onComplete?: () => void;
  /** Nombre de particules (défaut : 90 — volontairement discret). */
  particleCount?: number;
  /** Durée de vie nominale d'une particule en ms (défaut : 1800). */
  durationMs?: number;
}

export function Confetti({ active, onComplete, particleCount = 90, durationMs = 1800 }: ConfettiProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  // Callback stable pour ne pas relancer l'effet quand le parent re-render.
  const onCompleteRef = React.useRef(onComplete);
  React.useEffect(() => {
    onCompleteRef.current = onComplete;
  });

  React.useEffect(() => {
    if (!active) return;

    // Accessibilité : pas de pluie de particules en mouvement réduit.
    if (prefersReducedMotion) {
      onCompleteRef.current?.();
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Deux gerbes symétriques dans le tiers supérieur — effet organique.
    const origins = [
      { x: width * 0.32, y: height * 0.42 },
      { x: width * 0.68, y: height * 0.42 },
    ];

    const particles: Particle[] = Array.from({ length: particleCount }, (_, i) => {
      const origin = origins[i % origins.length] ?? { x: width / 2, y: height / 2 };
      // Éjection vers le haut, en éventail (±60° autour de la verticale).
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * (Math.PI / 1.5);
      const speed = 260 + Math.random() * 420;
      return {
        x: origin.x + (Math.random() - 0.5) * 24,
        y: origin.y + (Math.random() - 0.5) * 16,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 4 + Math.random() * 5,
        rotation: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 12,
        color: CONFETTI_PALETTE[i % CONFETTI_PALETTE.length] ?? CONFETTI_PALETTE[0]!,
        shape: Math.random() < 0.7 ? 'rect' : 'circle',
        life: durationMs * (0.7 + Math.random() * 0.6),
      };
    });

    const GRAVITY = 980; // px/s² — chute naturelle
    const DRAG = 0.9; // frottement de l'air (par seconde)
    let rafId = 0;
    let previous = performance.now();
    let elapsed = 0;
    let finished = false;

    const tick = (now: number) => {
      const dt = Math.min((now - previous) / 1000, 0.05); // clamp anti-onglet-inactif
      previous = now;
      elapsed += dt * 1000;

      ctx.clearRect(0, 0, width, height);
      let alive = 0;

      for (const p of particles) {
        if (elapsed >= p.life) continue;

        p.vy += GRAVITY * dt;
        p.vx *= 1 - (1 - DRAG) * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rotation += p.vr * dt;

        if (p.y > height + 20) continue;
        alive += 1;

        // Fondu sur le dernier tiers de vie.
        const remaining = 1 - elapsed / p.life;
        ctx.globalAlpha = Math.min(1, remaining * 3);
        ctx.fillStyle = p.color;

        if (p.shape === 'rect') {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          // Oscillation d'échelle verticale — illusion de « feuille » qui tournoie.
          ctx.scale(1, 0.35 + Math.abs(Math.sin(p.rotation * 1.5)) * 0.65);
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
          ctx.restore();
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size / 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.globalAlpha = 1;

      if (alive > 0) {
        rafId = requestAnimationFrame(tick);
      } else {
        finished = true;
        ctx.clearRect(0, 0, width, height);
        onCompleteRef.current?.();
      }
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      if (!finished) ctx.clearRect(0, 0, width, height);
    };
  }, [active, particleCount, durationMs, prefersReducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[70] h-full w-full"
    />
  );
}
