import type { Metadata } from 'next';
import { DashboardSidebar, type DashboardUser } from '@/components/dashboard';
import { ToastProvider, Toaster } from '@/components/ui';
import { auth } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'Dashboard — SallyCourse',
  description: 'Pilotez la génération de vos cours : production, statuts et publication.',
};

/**
 * Shell du groupe (dashboard) — sidebar fixe sur desktop (barre haute +
 * tiroir sur mobile, gérés par DashboardSidebar) et zone de contenu décalée.
 * `ps-*` logique : la mise en page s'inverse correctement en RTL.
 * Le rôle est lu côté serveur pour n'afficher le lien Admin qu'aux admins.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const isAdmin = session?.user?.role === 'admin';

  // Utilisateur réel affiché dans le menu de la sidebar (plan borné au type UI).
  const sidebarUser: DashboardUser | undefined = session?.user
    ? {
        name: session.user.name ?? session.user.email ?? 'Créateur',
        email: session.user.email ?? '',
        plan: session.user.plan,
      }
    : undefined;

  return (
    <ToastProvider>
      <div className="min-h-dvh bg-background">
        <DashboardSidebar isAdmin={isAdmin} user={sidebarUser} />
        <main className="lg:ps-64">
          <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-10">{children}</div>
        </main>
      </div>
      <Toaster />
    </ToastProvider>
  );
}
