import type { Metadata } from 'next';
import { requireUser } from '@/lib/session';
import { NicheResearchExplorer } from '@/components/niche-research';

/**
 * /dashboard/niche-research — outil « Trouver un sujet » (P86).
 * Page serveur minimale : garde d'auth, tout le formulaire + résultats vit
 * dans le composant client dédié (état local + server action).
 */
export const metadata: Metadata = {
  title: 'Trouver un sujet — SallyCourse',
  description: 'Explorez des sujets de cours par demande et concurrence estimées, par catégorie.',
};

export default async function NicheResearchPage() {
  await requireUser();

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-12">
      <NicheResearchExplorer />
    </main>
  );
}
