import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { connectDb, Course } from '@sallycourse/db';
import { requireUser } from '@/lib/session';
import { OnboardingWizard } from '@/components/onboarding';

/**
 * /dashboard/onboarding — assistant de premier cours (Prompt 58).
 * N'a de sens que si l'utilisateur n'a encore aucun cours : sinon on renvoie
 * vers le dashboard (l'onboarding est un moment unique, pas une page récurrente).
 */
export const metadata: Metadata = {
  title: 'Premier cours — SallyCourse',
  description:
    'Choisissez un modèle de niche et lancez votre premier cours en quelques clics.',
};

// Dépend de l'utilisateur et de l'état Mongo : rendu à la requête.
export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const user = await requireUser();

  await connectDb();
  const existing = await Course.countDocuments({ userId: user.id }).limit(1);
  // Déjà des cours : l'onboarding est terminé pour cet utilisateur.
  if (existing > 0) redirect('/dashboard');

  const displayName = user.name?.split(' ')[0] ?? undefined;

  return (
    <main className="min-h-dvh">
      <OnboardingWizard displayName={displayName} />
    </main>
  );
}
