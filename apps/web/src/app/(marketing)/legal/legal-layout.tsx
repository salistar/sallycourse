import Link from 'next/link';
import { FileText, ScrollText, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Gabarit partagé des pages légales (P66 — CGU/CGV/confidentialité).
 * Article sobre en `prose`-like maison (le projet n'a pas @tailwindcss/typography
 * dispo) : titres/paragraphes/listes stylés à la main avec les tokens sémantiques.
 */

const LEGAL_NAV = [
  { href: '/legal/cgu', label: 'CGU', icon: FileText },
  { href: '/legal/cgv', label: 'CGV', icon: ScrollText },
  { href: '/legal/confidentialite', label: 'Confidentialité', icon: ShieldCheck },
] as const;

export interface LegalPageProps {
  title: string;
  updatedAt: string;
  active: (typeof LEGAL_NAV)[number]['href'];
  children: React.ReactNode;
}

export function LegalPage({ title, updatedAt, active, children }: LegalPageProps) {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16 sm:py-20">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-semibold text-foreground sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-muted">Dernière mise à jour : {updatedAt}</p>
      </header>

      <nav aria-label="Documents légaux" className="mb-10 flex flex-wrap gap-2">
        {LEGAL_NAV.map((item) => {
          const isActive = item.href === active;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors duration-fast',
                isActive
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-surface text-muted hover:border-ring/50 hover:text-foreground',
              )}
            >
              <Icon className="size-3.5" aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <article className="legal-content flex flex-col gap-6 text-sm leading-relaxed text-foreground/90">
        {children}
      </article>
    </main>
  );
}

/** Titre de section (h2) — espacement homogène entre les blocs. */
export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-xl font-semibold text-foreground">{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}
