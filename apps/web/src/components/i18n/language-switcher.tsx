'use client';

import * as React from 'react';
import { useLocale } from 'next-intl';
import { Check, Languages } from 'lucide-react';
import { transitions } from '@/components/motion';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@/lib/cn';
import { LOCALE_COOKIE, locales, type Locale } from '@/i18n/routing';

/**
 * Sélecteur de langue de l'UI — écrit la préférence dans le cookie NEXT_LOCALE
 * puis recharge pour que le serveur re-render avec la nouvelle locale (messages
 * + dir RTL). Indépendant de la langue du CONTENU des cours (Course.locale).
 */

/** Libellés natifs de chaque locale (affichés dans leur propre langue). */
const LOCALE_LABELS: Record<Locale, string> = {
  fr: 'Français',
  en: 'English',
  ar: 'العربية',
};

/** Pose le cookie de langue (1 an, chemin racine) côté client. */
function setLocaleCookie(locale: Locale) {
  const oneYear = 60 * 60 * 24 * 365;
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${oneYear}; samesite=lax`;
}

export function LanguageSwitcher({ className }: { className?: string }) {
  const active = useLocale() as Locale;
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const onSelect = (locale: Locale) => {
    setOpen(false);
    if (locale === active) return;
    setLocaleCookie(locale);
    // Rechargement : le layout serveur relit le cookie et applique la locale.
    window.location.reload();
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="Langue"
            initial={{ opacity: 0, y: 6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={transitions.springSnappy}
            className="absolute bottom-full start-0 z-30 mb-2 w-full origin-bottom rounded-md border border-border bg-surface p-1.5 shadow-xl"
          >
            {locales.map((locale) => {
              const selected = locale === active;
              return (
                <button
                  key={locale}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => onSelect(locale)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-start text-sm',
                    'transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80',
                    selected ? 'bg-primary-soft text-foreground' : 'text-foreground hover:bg-primary-soft/60',
                  )}
                >
                  <span className="flex-1">{LOCALE_LABELS[locale]}</span>
                  {selected && <Check className="size-4 shrink-0 text-accent-400" aria-hidden="true" />}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-md border border-border bg-surface-subtle/60 px-3 py-2 text-start',
          'transition-colors duration-fast hover:border-ring/50 hover:bg-surface-subtle',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80',
        )}
      >
        <Languages className="size-4 shrink-0 text-muted" aria-hidden="true" />
        <span className="flex-1 truncate text-sm text-foreground">{LOCALE_LABELS[active]}</span>
      </button>
    </div>
  );
}
