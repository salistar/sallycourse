import type { Metadata } from 'next';
import { DesignStyleguide } from '@/components/design/styleguide';

/**
 * /design — direction artistique & moodboard codé SALISTAR.
 * Styleguide vivant : palette, typographie FR/AR, fondations, motion et
 * illustrations, observables en light / dark / RTL via la barre de contrôle.
 */

export const metadata: Metadata = {
  title: 'Direction artistique — SALISTAR · SallyCourse',
  description:
    'Le styleguide vivant de SallyCourse : palette violet & or, typographie Fraunces/Figtree/IBM Plex Sans Arabic, espacements, motion et illustrations de flux.',
};

export default function DesignPage() {
  return <DesignStyleguide />;
}
