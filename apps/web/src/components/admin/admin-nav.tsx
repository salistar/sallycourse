'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

/**
 * Barre d'onglets de l'espace admin (P57) : navigation entre la vue
 * d'ensemble, les utilisateurs, les cours et les jobs. L'onglet actif est
 * dérivé du pathname (préfixe le plus long, pour que /admin/users l'emporte
 * sur /admin).
 */

const TABS = [
  { href: '/admin', labelKey: 'tabs.overview' },
  { href: '/admin/users', labelKey: 'tabs.users' },
  { href: '/admin/courses', labelKey: 'tabs.courses' },
  { href: '/admin/costs', labelKey: 'tabs.costs' },
  { href: '/admin/revenue', labelKey: 'tabs.revenue' },
  { href: '/admin/payments/manual', labelKey: 'tabs.manualPayments' },
  { href: '/admin/jobs', labelKey: 'tabs.jobs' },
  { href: '/admin/resilience', labelKey: 'tabs.resilience' },
  { href: '/admin/prompts', labelKey: 'tabs.prompts' },
  { href: '/admin/audit', labelKey: 'tabs.audit' },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === '/admin';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNav() {
  const pathname = usePathname();
  const t = useTranslations('admin.nav');
  return (
    <nav aria-label={t('ariaLabel')} className="flex flex-wrap gap-2 border-b border-border pb-3">
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
            {t(tab.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
