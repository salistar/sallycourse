'use client';

import * as React from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Plus, Sparkles } from 'lucide-react';
import { buttonVariants } from '@/components/ui';
import { CountUp, StaggerItem, StaggerList } from '@/components/motion';
import { cn } from '@/lib/cn';
import type { DashboardStat } from './mock-data';
import { ImportArchiveButton } from './import-archive-button';

/**
 * Header du dashboard — salutation contextuelle selon l'heure locale et
 * rangée de statistiques clés en compteurs animés (CountUp, motion D4).
 */

/** Clé i18n de salutation selon l'heure (matin / après-midi / soir). */
function greetingKeyForHour(hour: number): 'greetingMorning' | 'greetingAfternoon' | 'greetingEvening' {
  if (hour >= 5 && hour < 12) return 'greetingMorning';
  if (hour >= 12 && hour < 18) return 'greetingAfternoon';
  return 'greetingEvening';
}

export interface GreetingHeaderProps {
  /** Prénom affiché dans la salutation. */
  firstName: string;
  stats: DashboardStat[];
  className?: string;
}

export function GreetingHeader({ firstName, stats, className }: GreetingHeaderProps) {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  // L'heure n'est connue de façon fiable que côté client : on rend une
  // salutation neutre au SSR puis on la précise après montage (pas de
  // mismatch d'hydratation).
  const [now, setNow] = React.useState<Date | null>(null);
  React.useEffect(() => {
    setNow(new Date());
  }, []);

  /** Date longue localisée (ex. « lundi 6 juillet »). */
  const formatToday = (date: Date): string =>
    new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(date);

  const greeting = t(now ? greetingKeyForHour(now.getHours()) : 'greetingMorning');

  return (
    <header className={cn('flex flex-col gap-6', className)}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
            <Sparkles className="size-3.5 text-accent-400" aria-hidden="true" />
            {/* Date rendue après montage uniquement — dépend du fuseau du client */}
            <span suppressHydrationWarning>{now ? formatToday(now) : t('title')}</span>
          </p>
          <h1 className="mt-1.5 font-display text-3xl font-semibold text-foreground sm:text-4xl">
            <span suppressHydrationWarning>{greeting}</span>, {firstName}
            <span className="text-accent-400"> .</span>
          </h1>
          <p className="mt-2 max-w-xl text-sm text-muted">{t('subtitle')}</p>
        </div>

        <div className="flex items-center gap-2">
          {/* Anti-lock-in P182 : re-création d'un cours depuis une archive maître. */}
          <ImportArchiveButton />
          <Link href="/dashboard/new" className={buttonVariants({ variant: 'gold', size: 'lg' })}>
            <Plus aria-hidden="true" />
            {t('newCourse')}
          </Link>
        </div>
      </div>

      {/* Statistiques clés — apparition orchestrée + compteurs animés */}
      <StaggerList className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {stats.map((stat) => (
          <StaggerItem key={stat.id}>
            <div
              className={cn(
                'group relative h-full overflow-hidden rounded-md border border-border bg-surface p-4 sm:p-5',
                'transition-colors duration-base hover:border-ring/50',
              )}
            >
              {/* Lueur d'angle — signature discrète au survol */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -end-8 -top-8 h-20 w-20 rounded-full bg-primary/20 blur-2xl transition-opacity duration-slow opacity-0 group-hover:opacity-100"
              />
              <p className="font-display text-3xl font-semibold text-foreground sm:text-4xl">
                <CountUp
                  value={stat.value}
                  decimals={Number.isInteger(stat.value) ? 0 : 1}
                  suffix={stat.suffix ?? ''}
                />
              </p>
              <p className="mt-1 text-xs font-medium text-muted sm:text-sm">{stat.label}</p>
              {stat.trend && <p className="mt-1.5 text-2xs font-medium text-success">{stat.trend}</p>}
            </div>
          </StaggerItem>
        ))}
      </StaggerList>
    </header>
  );
}
