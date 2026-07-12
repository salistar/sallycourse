import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { GraduationCap } from 'lucide-react';
import { ToastProvider, Toaster } from '@/components/ui';
import { resolveWhiteLabelSite } from '@/lib/white-label.server';

/**
 * Shell public white-label (Prompt 143) : équivalent de /learn mais rendu
 * sous le sous-domaine du client (academie-client.sallycourse.com), avec son
 * propre nom d'école à la place de « SallyCourse Academy ». Le middleware
 * réécrit toute requête sur ce sous-domaine vers /school/[subdomain]/...
 * (URL visible côté navigateur = le sous-domaine, pas /school/...).
 *
 * Un sous-domaine sans SchoolBranding correspondant (jamais configuré, ou
 * retiré depuis) → 404 immédiat.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}): Promise<Metadata> {
  const { subdomain } = await params;
  const site = await resolveWhiteLabelSite(subdomain);
  return {
    title: site ? `${site.schoolName} — Catalogue des cours` : 'Catalogue introuvable',
  };
}

export default async function SchoolLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain } = await params;
  const site = await resolveWhiteLabelSite(subdomain);
  if (!site) notFound();

  return (
    <ToastProvider>
      <div className="min-h-dvh bg-background">
        <header className="sticky top-0 z-20 border-b border-border bg-surface/80 backdrop-blur">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
            <span className="flex items-center gap-2 font-display text-lg font-semibold text-foreground">
              <GraduationCap className="size-5 text-primary" aria-hidden="true" />
              {site.schoolName}
            </span>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
      </div>
      <Toaster />
    </ToastProvider>
  );
}
