import { PageTransition } from '@/components/motion/page-transition';

/**
 * Template racine App Router — remonté à CHAQUE navigation (contrairement
 * au layout), ce qui rejoue la transition d'entrée de page (fade + slide).
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
