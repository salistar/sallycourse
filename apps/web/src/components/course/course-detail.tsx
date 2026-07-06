'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, CalendarDays, Download, GraduationCap, Languages, Rocket } from 'lucide-react';
import { Badge, Button, EmptyState, ToastProvider, Toaster, type BadgeProps } from '@/components/ui';
import { LessonTree } from './lesson-tree';
import { LessonPanel } from './lesson-panel';
import { ProgressBanner } from './progress-banner';
import type { CourseDetailView, CourseStatus, Difficulty, Locale } from './types';

/**
 * Expérience client de la page détail — en-tête (titre, statut, actions
 * cours), bandeau de progression si génération en cours, puis arborescence
 * des leçons à gauche et panneau de prévisualisation à droite.
 */

/** Statut de cours → variante Badge + libellé (aligné sur la carte dashboard). */
const COURSE_STATUS_BADGE: Record<
  CourseStatus,
  { variant: NonNullable<BadgeProps['variant']>; label: string }
> = {
  draft: { variant: 'draft', label: 'Brouillon' },
  generating: { variant: 'generating', label: 'Génération' },
  'outline-review': { variant: 'draft', label: 'Plan à valider' },
  ready: { variant: 'ready', label: 'Prêt' },
  published: { variant: 'published', label: 'Publié' },
  failed: { variant: 'failed', label: 'Échec' },
};

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: 'Débutant',
  intermediate: 'Intermédiaire',
  advanced: 'Avancé',
};

const LOCALE_LABELS: Record<Locale, string> = {
  fr: 'Français',
  en: 'English',
  ar: 'العربية',
};

export interface CourseDetailProps {
  course: CourseDetailView;
}

export function CourseDetail({ course }: CourseDetailProps) {
  const allLessons = React.useMemo(
    () => course.sections.flatMap((section) => section.lessons),
    [course.sections],
  );

  const [selectedId, setSelectedId] = React.useState<string | null>(allLessons[0]?.id ?? null);
  const selected = allLessons.find((lesson) => lesson.id === selectedId) ?? allLessons[0] ?? null;

  const badge = COURSE_STATUS_BADGE[course.status];
  const createdAt = new Date(course.createdAt);
  const lessonCount = allLessons.length;

  return (
    <ToastProvider>
      <div className="flex flex-col gap-8">
        {/* ── En-tête du cours ─────────────────────────────────── */}
        <header className="flex flex-col gap-4">
          <Link
            href="/dashboard"
            className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted transition-colors duration-fast hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Retour au dashboard
          </Link>

          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">
                  {course.title}
                </h1>
                <Badge variant={badge.variant}>{badge.label}</Badge>
              </div>
              <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <GraduationCap className="size-4" aria-hidden="true" />
                  {DIFFICULTY_LABELS[course.difficulty]}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Languages className="size-4" aria-hidden="true" />
                  {LOCALE_LABELS[course.locale]}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="size-4" aria-hidden="true" />
                  Créé le{' '}
                  {createdAt.toLocaleDateString('fr-FR', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </span>
                {lessonCount > 0 && (
                  <span className="tabular-nums">
                    {course.sections.length} section{course.sections.length > 1 ? 's' : ''} ·{' '}
                    {lessonCount} leçon{lessonCount > 1 ? 's' : ''}
                  </span>
                )}
              </p>
            </div>

            {/* Actions cours — mécaniques pack/déploiement à venir : UI seule. */}
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <span title="Bientôt disponible" className="inline-flex">
                <Button variant="secondary" size="sm" disabled aria-disabled="true">
                  <Download aria-hidden="true" />
                  Télécharger le pack
                </Button>
              </span>
              <span title="Bientôt disponible" className="inline-flex">
                <Button variant="gold" size="sm" disabled aria-disabled="true">
                  <Rocket aria-hidden="true" />
                  Déployer
                </Button>
              </span>
            </div>
          </div>
        </header>

        {/* ── Timeline de génération (cours en production) ─────── */}
        {course.status === 'generating' && <ProgressBanner courseId={course.id} />}

        {/* ── Arborescence + panneau de prévisualisation ───────── */}
        {course.sections.length === 0 ? (
          <EmptyState
            title={
              course.status === 'generating'
                ? 'Le plan du cours se construit…'
                : 'Aucune section pour le moment'
            }
            description={
              course.status === 'generating'
                ? 'Sections et leçons apparaîtront ici dès que le plan sera généré.'
                : course.status === 'failed'
                  ? 'La génération a échoué avant la création du plan. Relancez-la depuis le dashboard.'
                  : 'Ce cours ne contient pas encore de plan de leçons.'
            }
          />
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(280px,340px)_1fr]">
            <div className="rounded-lg border border-border bg-surface p-4 shadow-sm lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto">
              <LessonTree
                sections={course.sections}
                selectedId={selected?.id ?? null}
                onSelect={setSelectedId}
              />
            </div>
            <LessonPanel lesson={selected} locale={course.locale} />
          </div>
        )}
      </div>
      <Toaster />
    </ToastProvider>
  );
}
