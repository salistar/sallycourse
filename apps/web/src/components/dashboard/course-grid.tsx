'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Tabs, TabsList, TabsTrigger, EmptyState, buttonVariants } from '@/components/ui';
import { StaggerItem, StaggerList } from '@/components/motion';
import { cn } from '@/lib/cn';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { CourseCard } from './course-card';
import { FirstCourseEmpty } from './first-course-empty';
import type { DashboardCourse } from './mock-data';
import type { CourseStatus } from '@sallycourse/shared';

/**
 * Grille de cours — cartes riches en apparition orchestrée, filtres par
 * statut (Tabs D3) synchronisés avec l'URL (?status=…, deep-linkable).
 * Sans aucun cours : grand empty state « premier cours ».
 */

export type CourseFilterId = 'all' | 'active' | 'ready' | 'published' | 'draft';

const FILTERS: { id: CourseFilterId; label: string; statuses?: CourseStatus[] }[] = [
  { id: 'all', label: 'Tous' },
  { id: 'active', label: 'En production', statuses: ['generating', 'outline-review', 'failed'] },
  { id: 'ready', label: 'Prêts', statuses: ['ready'] },
  { id: 'published', label: 'Publiés', statuses: ['published'] },
  { id: 'draft', label: 'Brouillons', statuses: ['draft'] },
];

/** Assainit la valeur `?status=` de l'URL (valeur inconnue → 'all'). */
export function parseCourseFilter(value: string | undefined | null): CourseFilterId {
  return FILTERS.some((f) => f.id === value) ? (value as CourseFilterId) : 'all';
}

export interface CourseGridProps {
  courses: DashboardCourse[];
  /** Filtre actif dérivé des searchParams côté serveur. */
  activeFilter?: CourseFilterId;
  className?: string;
}

export function CourseGrid({ courses, activeFilter = 'all', className }: CourseGridProps) {
  const router = useRouter();
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
    <section className={cn('flex flex-col gap-5', className)} aria-label="Mes cours">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold text-foreground">Mes cours</h2>
        <span className="text-xs tabular-nums text-muted">
          {visible.length} / {courses.length} cours
        </span>
      </div>

      <Tabs value={filter} onValueChange={(v) => selectFilter(parseCourseFilter(v))}>
        <TabsList aria-label="Filtrer les cours par statut">
          {FILTERS.map((f) => (
            <TabsTrigger key={f.id} value={f.id}>
              {f.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {visible.length === 0 ? (
        <EmptyState
          title="Rien dans ce filtre"
          description="Aucun cours ne correspond à ce statut pour le moment — lancez une génération pour alimenter cette vue."
          action={
            <Link href="/dashboard/new" className={buttonVariants({ variant: 'primary', size: 'md' })}>
              <Plus aria-hidden="true" />
              Nouveau cours
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
