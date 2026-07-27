'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  CreditCard,
  Globe,
  KeyRound,
  Mic,
  Palette,
  Rocket,
  Server,
  TicketPercent,
  UserRound,
  UserSquare2,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useTranslations } from 'next-intl';

/**
 * Sous-navigation des Réglages (onglets horizontaux, défilable sur mobile).
 * Une entrée par section — l'état actif suit le segment d'URL courant.
 */

const SECTIONS = [
  { href: '/dashboard/settings/account', labelKey: 'account', icon: UserRound },
  { href: '/dashboard/settings/voice', labelKey: 'voice', icon: Mic },
  { href: '/dashboard/settings/avatar', labelKey: 'avatar', icon: UserSquare2 },
  { href: '/dashboard/settings/billing', labelKey: 'billing', icon: CreditCard },
  { href: '/dashboard/settings/platforms', labelKey: 'platforms', icon: Server },
  { href: '/dashboard/settings/deploy-presets', labelKey: 'deployPresets', icon: Rocket },
  { href: '/dashboard/settings/branding', labelKey: 'branding', icon: Palette },
  { href: '/dashboard/settings/public-page', labelKey: 'publicPage', icon: Globe },
  { href: '/dashboard/settings/coupons', labelKey: 'coupons', icon: TicketPercent },
  { href: '/dashboard/settings/api-keys', labelKey: 'apiKeys', icon: KeyRound },
  { href: '/dashboard/settings/activity', labelKey: 'activity', icon: Activity },
] as const;

export function SettingsNav() {
  const pathname = usePathname();
  const t = useTranslations('settings.nav');

  return (
    <nav aria-label={t('ariaLabel')} className="-mx-1 overflow-x-auto px-1">
      <ul className="flex min-w-max items-center gap-1.5 border-b border-border pb-px">
        {SECTIONS.map((section) => {
          const active = pathname === section.href || pathname.startsWith(`${section.href}/`);
          return (
            <li key={section.href}>
              <Link
                href={section.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 whitespace-nowrap rounded-t-md border-b-2 px-3 py-2 text-sm font-medium',
                  'transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80',
                  active
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted hover:border-border hover:text-foreground',
                )}
              >
                <section.icon className="size-4 shrink-0 opacity-80" aria-hidden="true" />
                {t(section.labelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
