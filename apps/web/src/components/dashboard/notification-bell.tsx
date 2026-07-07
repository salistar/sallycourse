'use client';

import * as React from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bell,
  CheckCheck,
  CheckCircle2,
  Rocket,
  ThumbsUp,
  ThumbsDown,
  AlertTriangle,
} from 'lucide-react';
import { transitions } from '@/components/motion';
import { cn } from '@/lib/cn';

/**
 * Cloche de notifications du header dashboard (Prompt 59). Composant client :
 * récupère /api/notifications, affiche un badge de non-lus, une liste
 * déroulante, et marque les entrées comme lues (une ou toutes). Polling léger
 * pour refléter les transitions émises par le worker/web.
 */

/** Type de notification — miroir de NotificationType (packages/db). */
type NotificationType =
  | 'generation_complete'
  | 'deployment_complete'
  | 'review_approved'
  | 'review_rejected'
  | 'quota_reached';

interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  read: boolean;
  link: string | null;
  createdAt: string;
}

interface NotificationsResponse {
  unreadCount: number;
  notifications: NotificationItem[];
}

/** Icône + teinte par type. */
const TYPE_META: Record<
  NotificationType,
  { icon: React.ComponentType<{ className?: string }>; tone: string }
> = {
  generation_complete: { icon: CheckCircle2, tone: 'text-primary-400' },
  deployment_complete: { icon: Rocket, tone: 'text-accent-400' },
  review_approved: { icon: ThumbsUp, tone: 'text-success' },
  review_rejected: { icon: ThumbsDown, tone: 'text-danger' },
  quota_reached: { icon: AlertTriangle, tone: 'text-warning' },
};

/** Intervalle de rafraîchissement (ms) tant que la cloche est montée. */
const POLL_INTERVAL = 45_000;

/** Formatage relatif court en français. */
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  return `il y a ${d} j`;
}

export function NotificationBell() {
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<NotificationItem[]>([]);
  const [unread, setUnread] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  const load = React.useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/notifications', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as NotificationsResponse;
      setItems(data.notifications);
      setUnread(data.unreadCount);
    } catch {
      // Silencieux : la cloche ne doit jamais casser le header.
    } finally {
      setLoading(false);
    }
  }, []);

  // Chargement initial + polling léger.
  React.useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [load]);

  // Fermeture au clic extérieur / Échap.
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const markOne = React.useCallback(async (id: string) => {
    // Optimiste : marque localement puis persiste.
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnread((u) => Math.max(0, u - 1));
    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
    } catch {
      /* best-effort */
    }
  }, []);

  const markAll = React.useCallback(async () => {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnread(0);
    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
    } catch {
      /* best-effort */
    }
  }, []);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="Notifications"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'relative flex h-10 w-10 items-center justify-center rounded-sm text-muted',
          'transition-colors duration-fast hover:bg-primary-soft hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80',
        )}
      >
        <Bell className="size-5" aria-hidden="true" />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute -end-0.5 -top-0.5 flex min-w-[18px] items-center justify-center rounded-full bg-accent-400 px-1 text-2xs font-bold text-neutral-950"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="Liste des notifications"
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={transitions.springSnappy}
            className="absolute end-0 z-40 mt-2 w-[min(360px,calc(100vw-2rem))] origin-top-end overflow-hidden rounded-md border border-border bg-surface shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-sm font-semibold text-foreground">Notifications</span>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={markAll}
                  className="flex items-center gap-1.5 rounded-sm px-1.5 py-1 text-2xs font-medium text-muted transition-colors duration-fast hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80"
                >
                  <CheckCheck className="size-3.5" aria-hidden="true" />
                  Tout marquer lu
                </button>
              )}
            </div>

            <div className="max-h-[min(60vh,420px)] overflow-y-auto">
              {items.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-muted">
                  {loading ? 'Chargement…' : 'Aucune notification pour le moment.'}
                </p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {items.map((n) => {
                    const meta = TYPE_META[n.type] ?? {
                      icon: Bell,
                      tone: 'text-muted',
                    };
                    const Icon = meta.icon;
                    const Row = (
                      <div
                        className={cn(
                          'flex gap-3 px-4 py-3 transition-colors duration-fast',
                          n.read ? 'bg-transparent' : 'bg-primary-soft/40',
                          (n.link || !n.read) && 'hover:bg-primary-soft/70',
                        )}
                      >
                        <Icon
                          className={cn('mt-0.5 size-[18px] shrink-0', meta.tone)}
                          aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-sm font-medium text-foreground">{n.title}</span>
                            {!n.read && (
                              <span
                                aria-hidden="true"
                                className="mt-1.5 size-2 shrink-0 rounded-full bg-accent-400"
                              />
                            )}
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-2xs text-muted">{n.body}</p>
                          <span className="mt-1 block text-2xs text-muted/70">
                            {timeAgo(n.createdAt)}
                          </span>
                        </div>
                      </div>
                    );

                    return (
                      <li key={n.id}>
                        {n.link ? (
                          <Link
                            href={n.link}
                            onClick={() => {
                              if (!n.read) void markOne(n.id);
                              setOpen(false);
                            }}
                            className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-400/80"
                          >
                            {Row}
                          </Link>
                        ) : (
                          <button
                            type="button"
                            onClick={() => !n.read && void markOne(n.id)}
                            className="block w-full text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-400/80"
                          >
                            {Row}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
