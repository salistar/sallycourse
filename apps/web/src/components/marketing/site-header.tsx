import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Sparkles } from 'lucide-react';
import { buttonVariants } from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * En-tête public (P95) — navigation marketing partagée par toutes les pages
 * du groupe (marketing). Server component (pas d'état) ; le sélecteur de
 * langue reste un composant client isolé.
 */
export async function SiteHeader() {
  const t = await getTranslations('marketing.nav');

  return (
    <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2 font-display text-lg font-semibold text-foreground">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-b from-accent-300 to-accent-500 text-accent-foreground">
            <Sparkles className="size-4" aria-hidden="true" />
          </span>
          SallyCourse
        </Link>

        <nav aria-label={t('features')} className="hidden items-center gap-6 md:flex">
          <Link href="/#fonctionnalites" className="text-sm font-medium text-muted transition-colors duration-fast hover:text-foreground">
            {t('features')}
          </Link>
          <Link href="/pricing" className="text-sm font-medium text-muted transition-colors duration-fast hover:text-foreground">
            {t('pricing')}
          </Link>
          <Link href="/showcase" className="text-sm font-medium text-muted transition-colors duration-fast hover:text-foreground">
            {t('showcase')}
          </Link>
        </nav>

        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="hidden text-sm font-medium text-muted transition-colors duration-fast hover:text-foreground sm:inline-block"
          >
            {t('login')}
          </Link>
          <Link href="/register" className={cn(buttonVariants({ variant: 'gold', size: 'sm' }))}>
            {t('cta')}
          </Link>
        </div>
      </div>
    </header>
  );
}
