import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { ToastProvider, Toaster } from '@/components/ui';

/**
 * Shell du groupe (auth) — écran centré, halos décoratifs violet/or et
 * marque cliquable au-dessus de la carte. ToastProvider local : les pages
 * d'auth vivent hors du shell dashboard.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-background px-4 py-12">
        {/* Halos décoratifs, purement visuels. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -start-32 -top-32 h-80 w-80 rounded-full bg-primary/15 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-32 -end-32 h-80 w-80 rounded-full bg-accent-400/10 blur-3xl"
        />

        <div className="relative z-10 flex w-full max-w-md flex-col gap-6">
          <Link
            href="/"
            className="mx-auto flex items-center gap-2 font-display text-2xl font-semibold text-foreground"
          >
            <Sparkles className="size-6 text-accent-400" aria-hidden="true" />
            SallyCourse
          </Link>
          {children}
        </div>
      </div>
      <Toaster />
    </ToastProvider>
  );
}
