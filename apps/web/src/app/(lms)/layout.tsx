import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { GraduationCap } from 'lucide-react';
import { ToastProvider, Toaster } from '@/components/ui';
import { auth } from '@/lib/auth';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('learn.layout');
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  };
}

/**
 * Shell public du LMS interne (/learn) : barre haute légère avec accès au
 * catalogue et au tableau de bord. Aucune sidebar — expérience apprenant.
 */
export default async function LmsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const isAuthenticated = Boolean(session?.user?.id);
  const t = await getTranslations('learn.layout');

  return (
    <ToastProvider>
      <div className="min-h-dvh bg-background">
        <header className="sticky top-0 z-20 border-b border-border bg-surface/80 backdrop-blur">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
            <Link href="/learn" className="flex items-center gap-2 font-display text-lg font-semibold text-foreground">
              <GraduationCap className="size-5 text-primary" aria-hidden="true" />
              SallyCourse Academy
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/learn" className="text-muted transition-colors hover:text-foreground">
                {t('nav.catalog')}
              </Link>
              {isAuthenticated ? (
                <Link href="/dashboard" className="font-medium text-primary hover:underline">
                  {t('nav.mySpace')}
                </Link>
              ) : (
                <Link href="/login" className="font-medium text-primary hover:underline">
                  {t('nav.signIn')}
                </Link>
              )}
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
      </div>
      <Toaster />
    </ToastProvider>
  );
}
