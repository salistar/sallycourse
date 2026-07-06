'use client';

/**
 * StaggerList / StaggerItem — apparition orchestrée des listes
 * (grilles de cours, résultats de recherche…). Le décalage entre items
 * communique l'ordre de lecture ; il se déclenche à l'entrée dans le
 * viewport pour accompagner le scroll.
 *
 * Usage :
 *   <StaggerList className="grid gap-4 sm:grid-cols-2">
 *     {courses.map((c) => <StaggerItem key={c.id}><CourseCard … /></StaggerItem>)}
 *   </StaggerList>
 */

import * as React from 'react';
import { motion, type Variants } from 'framer-motion';
import { cn } from '@/lib/cn';
import { fadeInUpVariants } from './motion-config';

export interface StaggerListProps {
  children: React.ReactNode;
  className?: string;
  /** Décalage entre deux items (secondes). */
  delayStep?: number;
  /** Retard avant le premier item (secondes). */
  initialDelay?: number;
  /** Ne jouer l'animation qu'une seule fois (défaut : true). */
  once?: boolean;
  /** Rendu sémantique : 'div' (défaut) ou 'ul' pour une vraie liste. */
  as?: 'div' | 'ul';
}

export function StaggerList({
  children,
  className,
  delayStep = 0.07,
  initialDelay = 0.1,
  once = true,
  as = 'div',
}: StaggerListProps) {
  // Le conteneur ne porte que l'orchestration ; le style visuel vit sur les items.
  const containerVariants: Variants = {
    hidden: {},
    visible: {
      transition: { staggerChildren: delayStep, delayChildren: initialDelay },
    },
  };

  const Component = as === 'ul' ? motion.ul : motion.div;

  return (
    <Component
      className={cn(as === 'ul' && 'list-none', className)}
      variants={containerVariants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once, amount: 0.15 }}
    >
      {children}
    </Component>
  );
}

export interface StaggerItemProps {
  children: React.ReactNode;
  className?: string;
  /** 'div' (défaut) ou 'li' quand le parent est une <ul>. */
  as?: 'div' | 'li';
}

export function StaggerItem({ children, className, as = 'div' }: StaggerItemProps) {
  const Component = as === 'li' ? motion.li : motion.div;
  return (
    <Component className={className} variants={fadeInUpVariants}>
      {children}
    </Component>
  );
}
