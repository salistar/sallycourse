'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info, Sparkles, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Système de toasts SALISTAR — `ToastProvider` (état global), hook
 * `useToast()` (API impérative `toast({...})`) et `<Toaster />` (viewport
 * fixe en bas, côté logique « end » pour un RTL correct).
 */

export type ToastVariant = 'default' | 'success' | 'warning' | 'danger' | 'info';

/** Action optionnelle (CTA) affichée sous la description du toast. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Durée d'affichage en ms (0 = persistant). Défaut : 5000. */
  duration?: number;
  action?: ToastAction;
}

interface ToastItem extends Required<Pick<ToastOptions, 'title' | 'variant' | 'duration'>> {
  id: number;
  description?: string;
  action?: ToastAction;
}

interface ToastContextValue {
  toasts: ToastItem[];
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

/** Hook d'émission : `const { toast } = useToast(); toast({ title: '…' })`. */
export function useToast(): Pick<ToastContextValue, 'toast' | 'dismiss'> {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error('useToast() doit être utilisé sous <ToastProvider>.');
  return { toast: ctx.toast, dismiss: ctx.dismiss };
}

let toastCounter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const timers = React.useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = React.useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback(
    ({ title, description, variant = 'default', duration = 5000, action }: ToastOptions): number => {
      const id = ++toastCounter;
      setToasts((current) => [...current.slice(-4), { id, title, description, variant, duration, action }]);
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
      return id;
    },
    [dismiss],
  );

  // Nettoyage des timers restants au démontage du provider.
  React.useEffect(() => {
    const map = timers.current;
    return () => map.forEach((timer) => clearTimeout(timer));
  }, []);

  const value = React.useMemo(() => ({ toasts, toast, dismiss }), [toasts, toast, dismiss]);

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

/** Icône et teintes par variante — DEFAULT thémés, contraste garanti. */
const VARIANT_STYLES: Record<ToastVariant, { icon: React.ElementType; accentBar: string; iconColor: string }> = {
  default: { icon: Sparkles, accentBar: 'bg-gradient-to-b from-primary-400 to-accent-400', iconColor: 'text-primary' },
  success: { icon: CheckCircle2, accentBar: 'bg-success', iconColor: 'text-success' },
  warning: { icon: AlertTriangle, accentBar: 'bg-warning', iconColor: 'text-warning' },
  danger: { icon: XCircle, accentBar: 'bg-danger', iconColor: 'text-danger' },
  info: { icon: Info, accentBar: 'bg-info', iconColor: 'text-info' },
};

/** Viewport des toasts — à placer une fois sous le provider (layout). */
export function Toaster() {
  const ctx = React.useContext(ToastContext);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  if (!ctx) throw new Error('<Toaster /> doit être utilisé sous <ToastProvider>.');
  if (!mounted) return null;

  return createPortal(
    <ol
      aria-label="Notifications"
      className="pointer-events-none fixed bottom-4 end-4 z-[60] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2"
    >
      <AnimatePresence initial={false}>
        {ctx.toasts.map((item) => {
          const { icon: Icon, accentBar, iconColor } = VARIANT_STYLES[item.variant];
          return (
            <motion.li
              key={item.id}
              layout
              initial={{ opacity: 0, x: 24, scale: 0.97 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.97 }}
              transition={{ duration: 0.25, ease: [0, 0, 0.2, 1] }}
              role="status"
              aria-live="polite"
              className={cn(
                'pointer-events-auto relative flex items-start gap-3 overflow-hidden',
                'rounded-md border border-border bg-surface p-4 pe-10 shadow-lg',
              )}
            >
              {/* Barre d'accent côté « start » (RTL natif) */}
              <span aria-hidden="true" className={cn('absolute inset-y-0 start-0 w-1', accentBar)} />
              <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', iconColor)} aria-hidden="true" />
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="text-sm font-semibold text-foreground">{item.title}</p>
                {item.description && <p className="text-xs text-muted">{item.description}</p>}
                {item.action && (
                  <button
                    type="button"
                    onClick={() => {
                      item.action?.onClick();
                      ctx.dismiss(item.id);
                    }}
                    className={cn(
                      'mt-1 self-start rounded-sm text-xs font-semibold text-primary underline-offset-2',
                      'transition-colors duration-fast hover:underline',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80',
                    )}
                  >
                    {item.action.label}
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => ctx.dismiss(item.id)}
                aria-label="Fermer la notification"
                className={cn(
                  'absolute end-2 top-2 rounded-sm p-1 text-muted',
                  'transition-colors duration-fast hover:bg-primary-soft hover:text-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80',
                )}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ol>,
    document.body,
  );
}
