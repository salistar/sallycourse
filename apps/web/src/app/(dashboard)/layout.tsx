import type { Metadata } from 'next';
import { DashboardSidebar } from '@/components/dashboard';

export const metadata: Metadata = {
  title: 'Dashboard — SallyCourse',
  description: 'Pilotez la génération de vos cours : production, statuts et publication.',
};

/**
 * Shell du groupe (dashboard) — sidebar fixe sur desktop (barre haute +
 * tiroir sur mobile, gérés par DashboardSidebar) et zone de contenu décalée.
 * `ps-*` logique : la mise en page s'inverse correctement en RTL.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background">
      <DashboardSidebar />
      <main className="lg:ps-64">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-10">{children}</div>
      </main>
    </div>
  );
}
