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

/** Premier élément d'un searchParam (string | string[] | undefined). */
function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * La page accepte ?template=<id> et ?title=<texte> pour partir d'un template
 * de niche (Prompt 58) — typiquement depuis l'assistant d'onboarding.
 */
export default async function NewCoursePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return (
    <CreateCourseExperience
      initialTemplateId={firstParam(params.template)}
      initialTitle={firstParam(params.title)}
    />
  );
}
