'use client';

/**
 * Transition de page — App Router.
 * Montée + fondu discrets (200 ms) à chaque navigation, via
 * apps/web/src/app/template.tsx (un template est REMONTÉ à chaque route,
 * ce qui rejoue l'animation d'entrée — exactement le comportement voulu).
 *
 * Le mouvement communique le changement de contexte sans le ralentir :
 * plus court que `slow`, plus perceptible que `fast`.
 */

import * as React from 'react';
import { motion } from 'framer-motion';
import { motionEasings } from './motion-config';

/** Durée dédiée aux transitions de page (spec motion D4 : 200 ms). */
const PAGE_TRANSITION_SECONDS = 0.2;

export interface PageTransitionProps {
  children: React.ReactNode;
}

export function PageTransition({ children }: PageTransitionProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: PAGE_TRANSITION_SECONDS, ease: motionEasings.out }}
    >
      {children}
    </motion.div>
  );
}
