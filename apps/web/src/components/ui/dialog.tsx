'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Dialogue modal SALISTAR — contrôlé (`open` / `onOpenChange`), rendu en
 * portal avec backdrop flouté, fermeture Échap / clic extérieur, piège de
 * focus clavier et verrouillage du scroll. Sans dépendance Radix.
 */

interface DialogContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  titleId: string;
  descriptionId: string;
}

const DialogContext = React.createContext<DialogContextValue | null>(null);

function useDialogContext(component: string): DialogContextValue {
  const ctx = React.useContext(DialogContext);
  if (!ctx) throw new Error(`<${component}> doit être utilisé à l'intérieur de <Dialog>.`);
  return ctx;
}

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  const baseId = React.useId();
  const value = React.useMemo<DialogContextValue>(
    () => ({
      open,
      setOpen: onOpenChange,
      titleId: `${baseId}-title`,
      descriptionId: `${baseId}-description`,
    }),
    [open, onOpenChange, baseId],
  );
  return <DialogContext.Provider value={value}>{children}</DialogContext.Provider>;
}

/** Bouton déclencheur pratique (ouvre le dialogue au clic). */
export const DialogTrigger = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ onClick, ...props }, ref) => {
    const { setOpen } = useDialogContext('DialogTrigger');
    return (
      <button
        ref={ref}
        type="button"
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) setOpen(true);
        }}
        {...props}
      />
    );
  },
);
DialogTrigger.displayName = 'DialogTrigger';

/** Sélecteur des éléments focusables pour le piège de focus. */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogContentProps
  extends Omit<
    React.HTMLAttributes<HTMLDivElement>,
    // Handlers dont la signature diverge entre React et Framer Motion
    'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'
  > {
  /** Masque le bouton de fermeture intégré (coin supérieur). */
  hideClose?: boolean;
}

export function DialogContent({ className, children, hideClose = false, ...props }: DialogContentProps) {
  const t = useTranslations('common');
  const { open, setOpen, titleId, descriptionId } = useDialogContext('DialogContent');
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = React.useState(false);

  // Portal côté client uniquement (évite tout écart SSR/hydratation).
  React.useEffect(() => setMounted(true), []);

  // Échap ferme + verrouillage du scroll du document tant que le dialogue est ouvert.
  React.useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
      if (event.key === 'Tab') {
        // Piège de focus : Tab boucle à l'intérieur du panneau.
        const panel = panelRef.current;
        if (!panel) return;
        const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (!first || !last) return;
        const active = document.activeElement as HTMLElement | null;
        if (event.shiftKey && (active === first || !panel.contains(active))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, setOpen]);

  // Focus initial sur le panneau à l'ouverture, restitution à la fermeture.
  React.useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => panelRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          {/* Backdrop flouté — clic = fermeture */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            onClick={() => setOpen(false)}
            aria-hidden="true"
            className="absolute inset-0 bg-neutral-950/70 backdrop-blur-md"
          />
          {/* Panneau centré */}
          <div className="pointer-events-none absolute inset-0 grid place-items-center p-4">
            <motion.div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={descriptionId}
              tabIndex={-1}
              initial={{ opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.25, ease: [0.34, 1.56, 0.64, 1] }}
              className={cn(
                'pointer-events-auto relative w-full max-w-lg rounded-lg border border-border bg-surface p-6 shadow-xl outline-none',
                className,
              )}
              {...props}
            >
              {children}
              {!hideClose && (
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={t('closeDialog')}
                  className={cn(
                    'absolute end-4 top-4 rounded-sm p-1.5 text-muted',
                    'transition-colors duration-fast hover:bg-primary-soft hover:text-foreground',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80',
                  )}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1.5 pe-8', className)} {...props} />;
}

export function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  const { titleId } = useDialogContext('DialogTitle');
  return (
    <h2 id={titleId} className={cn('font-display text-xl font-semibold text-foreground', className)} {...props} />
  );
}

export function DialogDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  const { descriptionId } = useDialogContext('DialogDescription');
  return <p id={descriptionId} className={cn('text-sm text-muted', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-6 flex flex-wrap items-center justify-end gap-3', className)} {...props} />;
}

/** Bouton utilitaire qui ferme le dialogue au clic. */
export const DialogClose = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ onClick, ...props }, ref) => {
    const { setOpen } = useDialogContext('DialogClose');
    return (
      <button
        ref={ref}
        type="button"
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) setOpen(false);
        }}
        {...props}
      />
    );
  },
);
DialogClose.displayName = 'DialogClose';
