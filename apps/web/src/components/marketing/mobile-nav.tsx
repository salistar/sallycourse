'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion } from 'framer-motion';
import { Menu, X } from 'lucide-react';
import { buttonVariants } from '@/components/ui';
import { transitions } from '@/components/motion/motion-config';
import { cn } from '@/lib/cn';

/**
 * Navigation mobile du site marketing (audit design #responsive) : jusqu'ici la
 * nav et le lien Connexion étaient simplement masqués sous `md`, laissant un
 * visiteur mobile sans accès à /pricing, /showcase, /marketplace ni /login.
 * Île client (hamburger + panneau), rendue par le SiteHeader (server component)
 * qui lui passe les libellés traduits. Visible uniquement sous `md`.
 */
export interface MobileNavLink {
  href: string;
  label: string;
}

export function MobileNav({
  links,
  loginLabel,
  ctaLabel,
  menuLabel,
}: {
  links: MobileNavLink[];
  loginLabel: string;
  ctaLabel: string;
  menuLabel: string;
}) {
  const t = useTranslations('marketing.mobileNav');
  const [open, setOpen] = React.useState(false);

  // Verrouille le scroll de la page tant que le panneau est ouvert.
  React.useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label={menuLabel}
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="flex h-9 w-9 items-center justify-center rounded-sm text-muted transition-colors hover:bg-primary-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80"
      >
        <Menu className="size-5" aria-hidden="true" />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={transitions.enter}
              className="fixed inset-0 z-40 bg-neutral-950/60 backdrop-blur-sm"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />
            <motion.nav
              aria-label={menuLabel}
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={transitions.springSoft}
              className="fixed inset-y-0 end-0 z-50 flex w-72 max-w-[80vw] flex-col gap-1 border-s border-border bg-surface p-4 shadow-xl"
            >
              <div className="flex items-center justify-between pb-3">
                <span className="text-sm font-semibold text-foreground">{menuLabel}</span>
                <button
                  type="button"
                  aria-label={t('close')}
                  onClick={() => setOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-sm text-muted hover:bg-primary-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>

              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="rounded-sm px-3 py-2.5 text-sm font-medium text-foreground hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80"
                >
                  {link.label}
                </Link>
              ))}

              <div className="mt-auto flex flex-col gap-2 border-t border-border pt-3">
                <Link
                  href="/login"
                  onClick={() => setOpen(false)}
                  className="rounded-sm px-3 py-2.5 text-sm font-medium text-muted hover:bg-primary-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80"
                >
                  {loginLabel}
                </Link>
                <Link
                  href="/register"
                  onClick={() => setOpen(false)}
                  className={cn(buttonVariants({ variant: 'gold', size: 'sm' }), 'justify-center')}
                >
                  {ctaLabel}
                </Link>
              </div>
            </motion.nav>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
