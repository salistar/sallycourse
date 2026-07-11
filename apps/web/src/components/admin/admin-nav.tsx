'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

/**
 * Barre d'onglets de l'espace admin (P57) : navigation entre la vue
 * d'ensemble, les utilisateurs, les cours et les jobs. L'onglet actif est
 * dérivé du pathname (préfixe le plus long, pour que /admin/users l'emporte
 * sur /admin).
 */

const TABS = [
  { href: '/admin', label: 'Vue d’ensemble' },
  { href: '/admin/users', label: 'Utilisateurs' },
  { href: '/admin/courses', label: 'Cours' },
  { href: '/admin/costs', label: 'Coûts' },
  { href: '/admin/jobs', label: 'Jobs' },
  { href: '/admin/resilience', label: 'Résilience' },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === '/admin';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Sections admin" className="flex flex-wrap gap-2 border-b border-border pb-3">
      {TABS.map((tab) => {
        const active = isActive(pathname, tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-full px-3 py-1.5 text-sm font-semibold transition-colors duration-fast',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80',
              active
                ? 'bg-primary-soft text-foreground'
                : 'text-muted hover:bg-surface hover:text-foreground',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
