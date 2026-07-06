'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronsUpDown,
  LayoutDashboard,
  LogOut,
  Menu,
  PlusCircle,
  Settings,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';
import { transitions } from '@/components/motion';
import { cn } from '@/lib/cn';
import { MOCK_USER, userInitials, type DashboardUser } from './mock-data';

/**
 * Navigation du shell dashboard — sidebar fixe sur desktop, barre haute +
 * tiroir sur mobile. Logo SallyCourse, liens (Dashboard / Nouveau cours /
 * Paramètres) avec état actif, menu utilisateur en pied de colonne.
 */

/* ------------------------------------------------------------------ */
/* Logo                                                                */
/* ------------------------------------------------------------------ */

/** Monogramme SALISTAR — losange violet/or, 100 % classes de tokens. */
function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('shrink-0', className)} aria-hidden="true">
      <rect x="7" y="7" width="18" height="18" rx="5" transform="rotate(45 16 16)" className="fill-primary-600" />
      <rect x="11.5" y="11.5" width="9" height="9" rx="2.5" transform="rotate(45 16 16)" className="fill-accent-400" />
    </svg>
  );
}

function Logo() {
  return (
    <Link
      href="/dashboard"
      className="flex items-center gap-2.5 rounded-sm px-2 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80"
    >
      <LogoMark className="h-7 w-7" />
      <span className="font-display text-lg font-semibold tracking-tight text-foreground">
        Sally<span className="text-accent-400">Course</span>
      </span>
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Liens de navigation                                                 */
/* ------------------------------------------------------------------ */

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Actif uniquement sur correspondance exacte (évite /dashboard actif sur /dashboard/new). */
  exact?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/dashboard/new', label: 'Nouveau cours', icon: PlusCircle },
  { href: '/settings', label: 'Paramètres', icon: Settings },
];

/** Entrée réservée au rôle admin — supervision des jobs de génération. */
const ADMIN_NAV_ITEM: NavItem = { href: '/admin/jobs', label: 'Admin', icon: ShieldCheck };

function NavLinks({ onNavigate, isAdmin }: { onNavigate?: () => void; isAdmin?: boolean }) {
  const pathname = usePathname();
  const items = isAdmin ? [...NAV_ITEMS, ADMIN_NAV_ITEM] : NAV_ITEMS;

  return (
    <nav aria-label="Navigation principale" className="flex flex-col gap-1">
      {items.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group relative flex items-center gap-3 rounded-sm px-3 py-2.5 text-sm font-medium',
              'transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80',
              active
                ? 'bg-primary-soft text-foreground'
                : 'text-muted hover:bg-primary-soft/60 hover:text-foreground',
            )}
          >
            {/* Marqueur actif — trait dégradé côté début de ligne */}
            <span
              aria-hidden="true"
              className={cn(
                'absolute inset-y-2 start-0 w-0.5 rounded-full bg-gradient-to-b from-primary-400 to-accent-400',
                'transition-opacity duration-fast',
                active ? 'opacity-100' : 'opacity-0',
              )}
            />
            <item.icon
              className={cn('h-[18px] w-[18px] shrink-0', active ? 'text-accent-400' : 'text-muted group-hover:text-foreground')}
              aria-hidden="true"
            />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Menu utilisateur                                                    */
/* ------------------------------------------------------------------ */

const PLAN_LABELS: Record<DashboardUser['plan'], string> = {
  free: 'Gratuit',
  pro: 'Pro',
  business: 'Business',
};

function UserMenu({ user }: { user: DashboardUser }) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const items = [
    { id: 'profile', label: 'Profil', icon: UserRound },
    { id: 'settings', label: 'Paramètres', icon: Settings },
    { id: 'logout', label: 'Se déconnecter', icon: LogOut, danger: true },
  ];

  return (
    <div ref={rootRef} className="relative">
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="Menu utilisateur"
            initial={{ opacity: 0, y: 6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={transitions.springSnappy}
            className="absolute bottom-full start-0 z-30 mb-2 w-full origin-bottom rounded-md border border-border bg-surface p-1.5 shadow-xl"
          >
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  // Déconnexion réelle (Auth.js) — retour à l'écran de connexion.
                  if (item.id === 'logout') void signOut({ callbackUrl: '/login' });
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-start text-sm',
                  'transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80',
                  item.danger ? 'text-danger hover:bg-danger/10' : 'text-foreground hover:bg-primary-soft',
                )}
              >
                <item.icon className="size-4 shrink-0 opacity-70" aria-hidden="true" />
                {item.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center gap-3 rounded-md border border-border bg-surface-subtle/60 px-3 py-2.5 text-start',
          'transition-colors duration-fast hover:border-ring/50 hover:bg-surface-subtle',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80',
        )}
      >
        {/* Avatar — initiales sur dégradé de marque */}
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-primary-700 text-xs font-bold text-primary-foreground ring-1 ring-accent-400/50"
        >
          {userInitials(user.name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">{user.name}</span>
          <span className="block truncate text-2xs text-muted">
            Plan {PLAN_LABELS[user.plan]} · {user.email}
          </span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted" aria-hidden="true" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shell : sidebar desktop + barre/tiroir mobile                       */
/* ------------------------------------------------------------------ */

/** Contenu partagé entre la sidebar desktop et le tiroir mobile. */
function SidebarContent({
  onNavigate,
  isAdmin,
  user,
}: {
  onNavigate?: () => void;
  isAdmin?: boolean;
  user: DashboardUser;
}) {
  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <Logo />
      <NavLinks onNavigate={onNavigate} isAdmin={isAdmin} />
      <div className="mt-auto">
        <UserMenu user={user} />
      </div>
    </div>
  );
}

export interface DashboardSidebarProps {
  /** Affiche le lien Admin (rôle admin uniquement — fourni par le layout serveur). */
  isAdmin?: boolean;
  /** Utilisateur connecté (fourni par le layout serveur) — mock en secours. */
  user?: DashboardUser;
}

export function DashboardSidebar({ isAdmin = false, user = MOCK_USER }: DashboardSidebarProps) {
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const pathname = usePathname();

  // Fermer le tiroir mobile à chaque navigation.
  React.useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Sidebar desktop — fixe côté début de ligne (RTL ok) */}
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-64 border-e border-border bg-surface/60 backdrop-blur-sm lg:block">
        <SidebarContent isAdmin={isAdmin} user={user} />
      </aside>

      {/* Barre haute mobile */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/80 px-4 py-3 backdrop-blur-md lg:hidden">
        <Logo />
        <button
          type="button"
          aria-label={drawerOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen((v) => !v)}
          className="flex h-10 w-10 items-center justify-center rounded-sm text-muted transition-colors duration-fast hover:bg-primary-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80"
        >
          {drawerOpen ? <X className="size-5" aria-hidden="true" /> : <Menu className="size-5" aria-hidden="true" />}
        </button>
      </header>

      {/* Tiroir mobile */}
      <AnimatePresence>
        {drawerOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={() => setDrawerOpen(false)}
              className="fixed inset-0 z-40 bg-neutral-950/70 backdrop-blur-sm lg:hidden"
              aria-hidden="true"
            />
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={transitions.springSoft}
              className="fixed inset-y-0 start-0 z-50 w-72 border-e border-border bg-surface shadow-xl lg:hidden"
            >
              <SidebarContent onNavigate={() => setDrawerOpen(false)} isAdmin={isAdmin} user={user} />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
