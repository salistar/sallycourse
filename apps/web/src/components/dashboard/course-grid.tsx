'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Tabs, TabsList, TabsTrigger, EmptyState, buttonVariants } from '@/components/ui';
import { StaggerItem, StaggerList } from '@/components/motion';
import { cn } from '@/lib/cn';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { CourseCard } from './course-card';
import { FirstCourseEmpty } from './first-course-empty';
import type { DashboardCourse } from './mock-data';
import { FILTERS, parseCourseFilter, type CourseFilterId } from './course-filter';

/**
 * Grille de cours — cartes riches en apparition orchestrée, filtres par
 * statut (Tabs D3) synchronisés avec l'URL (?status=…, deep-linkable).
 * Sans aucun cours : grand empty state « premier cours ».
 */

export type { CourseFilterId } from './course-filter';

export interface CourseGridProps {
  courses: DashboardCourse[];
  /** Filtre actif dérivé des searchParams côté serveur. */
  activeFilter?: CourseFilterId;
  className?: string;
}

export function CourseGrid({ courses, activeFilter = 'all', className }: CourseGridProps) {
  const router = useRouter();
  const t = useTranslations('dashboard.courseGrid');
  // État local pour un feedback instantané ; l'URL reste la source de vérité.
  const [filter, setFilter] = React.useState<CourseFilterId>(activeFilter);

  React.useEffect(() => {
    setFilter(activeFilter);
  }, [activeFilter]);

  // Aucun cours du tout : l'expérience « premier cours » prend toute la place.
  if (courses.length === 0) {
    return <FirstCourseEmpty className={className} />;
  }

  const selectFilter = (next: CourseFilterId): void => {
    setFilter(next);
    // Filtre reflété dans l'URL — partageable et conservé au refresh.
    router.replace(next === 'all' ? '/dashboard' : `/dashboard?status=${next}`, { scroll: false });
  };

  const active = FILTERS.find((f) => f.id === filter) ?? FILTERS[0]!;
  const visible = active.statuses ? courses.filter((c) => active.statuses!.includes(c.status)) : courses;

  return (
    <section className={cn('flex flex-col gap-5', className)} aria-label={t('title')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold text-foreground">{t('title')}</h2>
        <span className="text-xs tabular-nums text-muted">
          {t('countLabel', { visible: visible.length, total: courses.length })}
        </span>
      </div>

      <Tabs value={filter} onValueChange={(v) => selectFilter(parseCourseFilter(v))}>
        <TabsList aria-label={t('filterAria')}>
          {FILTERS.map((f) => (
            <TabsTrigger key={f.id} value={f.id}>
              {f.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {visible.length === 0 ? (
        <EmptyState
          title={t('emptyFilterTitle')}
          description={t('emptyFilterDescription')}
          action={
            <Link href="/dashboard/new" className={buttonVariants({ variant: 'primary', size: 'md' })}>
              <Plus aria-hidden="true" />
              {t('newCourse')}
            </Link>
          }
        />
      ) : (
        // key={filter} : rejoue l'orchestration à chaque changement de filtre
        <StaggerList key={filter} className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3">
          {visible.map((course) => (
            <StaggerItem key={course.id} className="h-full">
              <CourseCard course={course} />
            </StaggerItem>
          ))}
        </StaggerList>
      )}
    </section>
  );
}
