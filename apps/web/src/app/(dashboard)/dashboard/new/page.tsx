import type { Metadata } from 'next';
import { CreateCourseExperience } from '@/components/create/create-course-experience';

/**
 * /dashboard/new — création d'un cours.
 * Page serveur minimale : tout le moment signature (titre géant, niveaux,
 * transition vers la génération) vit dans le composant client dédié.
 */
export const metadata: Metadata = {
  title: 'Nouveau cours — SallyCourse',
  description:
    'Écrivez la couverture de votre cours : un titre, un niveau, et l’IA compose le reste.',
};

export default function NewCoursePage() {
  return <CreateCourseExperience />;
}
