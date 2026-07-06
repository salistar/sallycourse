/**
 * Système de motion SALISTAR — point d'entrée unique.
 * Configuration (durées/courbes tokens, MotionProvider), transitions de page,
 * listes orchestrées, timeline de génération, célébration, compteurs, tilt.
 */
export {
  MotionProvider,
  usePrefersReducedMotion,
  motionDurations,
  motionEasings,
  transitions,
  fadeInVariants,
  fadeInUpVariants,
  scaleInVariants,
  type MotionProviderProps,
} from './motion-config';
export { PageTransition, type PageTransitionProps } from './page-transition';
export {
  StaggerList,
  StaggerItem,
  type StaggerListProps,
  type StaggerItemProps,
} from './stagger-list';
export {
  GenerationTimeline,
  type GenerationTimelineProps,
  type GenerationStep,
  type GenerationTimelineStatus,
} from './generation-timeline';
export { Confetti, type ConfettiProps } from './confetti';
export { CountUp, type CountUpProps } from './count-up';
export { TiltCard, type TiltCardProps } from './tilt-card';
