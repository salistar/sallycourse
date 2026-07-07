'use client';

import * as React from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowRight, Sparkles } from 'lucide-react';
import { buttonVariants } from '@/components/ui';
import { motionEasings, usePrefersReducedMotion } from '@/components/motion';
import { cn } from '@/lib/cn';

/**
 * Empty state « premier cours » — illustration géométrique ANIMÉE (losange
 * signature qui lévite, satellites en orbite, étincelles) et grand CTA or.
 * Tout le mouvement est en boucle douce et respecte prefers-reduced-motion.
 */

/** Illustration animée — composition violet/or 100 % tokens. */
function AnimatedIllustration() {
  const reduced = usePrefersReducedMotion();
  // En mouvement réduit, les éléments restent posés (aucune boucle infinie).
  const float = (delay: number) =>
    reduced
      ? undefined
      : {
          animate: { y: [0, -10, 0] },
          transition: { duration: 4.5, ease: motionEasings.standard, repeat: Infinity, delay },
        };

  return (
    <div className="relative mx-auto h-52 w-64" aria-hidden="true">
      {/* Halo de fond qui respire */}
      <motion.div
        className="absolute inset-x-8 inset-y-6 rounded-full bg-primary/20 blur-3xl"
        animate={reduced ? undefined : { opacity: [0.5, 0.9, 0.5], scale: [1, 1.08, 1] }}
        transition={{ duration: 5, ease: motionEasings.standard, repeat: Infinity }}
      />

      {/* Anneau en orbite lente */}
      <motion.svg
        viewBox="0 0 256 208"
        className="absolute inset-0 h-full w-full"
        animate={reduced ? undefined : { rotate: 360 }}
        transition={{ duration: 40, ease: 'linear', repeat: Infinity }}
        style={{ originX: '50%', originY: '50%' }}
      >
        <ellipse cx="128" cy="104" rx="104" ry="66" className="fill-none stroke-primary-400/30" strokeWidth="1" strokeDasharray="4 7" />
        <circle cx="232" cy="104" r="5" className="fill-accent-400" />
        <circle cx="24" cy="104" r="3.5" className="fill-primary-400" />
      </motion.svg>

      {/* Losange signature — lévitation */}
      <motion.div className="absolute inset-0 flex items-center justify-center" {...float(0)}>
        <div className="relative">
          <div className="h-24 w-24 rotate-45 rounded-xl bg-gradient-to-br from-primary-500/40 to-primary-800/60 shadow-glow ring-1 ring-primary-400/60" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-10 w-10 rotate-45 rounded-md bg-gradient-to-br from-accent-300 to-accent-500 shadow-md" />
          </div>
        </div>
      </motion.div>

      {/* Satellites flottants, déphasés */}
      <motion.div className="absolute start-6 top-8" {...float(0.8)}>
        <div className="h-4 w-4 rotate-45 rounded-sm bg-primary-400/60" />
      </motion.div>
      <motion.div className="absolute end-8 top-14" {...float(1.6)}>
        <div className="h-3 w-3 rounded-full border-2 border-accent-400" />
      </motion.div>
      <motion.div className="absolute bottom-10 start-12" {...float(2.4)}>
        <Sparkles className="size-5 text-accent-300" />
      </motion.div>
      <motion.div className="absolute bottom-6 end-10" {...float(1.2)}>
        <div className="h-2.5 w-2.5 rounded-full bg-primary-300/70" />
      </motion.div>
    </div>
  );
}

export interface FirstCourseEmptyProps {
  className?: string;
}

export function FirstCourseEmpty({ className }: FirstCourseEmptyProps) {
  return (
    <section
      aria-label="Créer votre premier cours"
      className={cn(
        'relative overflow-hidden rounded-lg border border-dashed border-border bg-surface-subtle/50',
        'px-6 py-14 text-center sm:px-12 sm:py-20',
        className,
      )}
    >
      <AnimatedIllustration />

      <h2 className="mx-auto mt-6 max-w-2xl font-display text-2xl font-semibold text-foreground sm:text-3xl">
        Votre premier cours n’attend qu’un titre
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
        Donnez un sujet et un niveau — SallyCourse rédige le plan, écrit les leçons, enregistre la
        narration, monte les vidéos et assemble les quiz. Un cours complet, prêt à publier.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link href="/dashboard/onboarding" className={buttonVariants({ variant: 'gold', size: 'lg' })}>
          <Sparkles aria-hidden="true" />
          Créer mon premier cours
          <ArrowRight aria-hidden="true" className="rtl:rotate-180" />
        </Link>
        <Link href="/dashboard/new" className={buttonVariants({ variant: 'ghost', size: 'lg' })}>
          Partir d’une page blanche
        </Link>
      </div>

      <p className="mt-5 text-2xs uppercase tracking-wide text-muted">
        ≈ 25 minutes de génération pour un cours de 5 heures
      </p>
    </section>
  );
}
