'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { FileText, FlaskConical, HelpCircle, Video, type LucideIcon } from 'lucide-react';
import { Badge, type BadgeProps } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { LessonStatus, LessonType, SectionView } from './types';

/**
 * Arborescence sections → leçons — navigation de la page détail.
 * Chaque leçon porte son icône de type et son badge de statut ; la leçon
 * sélectionnée alimente le panneau de droite.
 */

const TYPE_ICONS: Record<LessonType, LucideIcon> = {
  video: Video,
  article: FileText,
  tp: FlaskConical,
  quiz: HelpCircle,
};

/** Statut de leçon → variante du Badge existant + libellé français. */
export const LESSON_STATUS_BADGE: Record<
  LessonStatus,
  { variant: NonNullable<BadgeProps['variant']>; label: string }
> = {
  pending: { variant: 'draft', label: 'En attente' },
  generating: { variant: 'generating', label: 'Génération' },
  ready: { variant: 'ready', label: 'Prête' },
  failed: { variant: 'failed', label: 'Échec' },
};

export interface LessonTreeProps {
  sections: SectionView[];
  selectedId: string | null;
  onSelect: (lessonId: string) => void;
  className?: string;
}

export function LessonTree({ sections, selectedId, onSelect, className }: LessonTreeProps) {
  const t = useTranslations('course.lessonTree');
  return (
    <nav aria-label={t('navLabel')} className={cn('flex flex-col gap-6', className)}>
      {sections.map((section, sectionIndex) => (
        <section key={section.id} aria-label={section.title}>
          <header className="mb-2 flex items-baseline justify-between gap-2 px-1">
            <h3 className="min-w-0 truncate text-sm font-semibold text-foreground">
              <span className="me-1.5 tabular-nums text-muted">{sectionIndex + 1}.</span>
              {section.title}
            </h3>
            <span className="shrink-0 text-2xs font-medium uppercase tracking-wide text-muted">
              {t('lessonCount', { count: section.lessons.length })}
            </span>
          </header>

          <ol className="m-0 flex list-none flex-col gap-1 p-0">
            {section.lessons.map((lesson) => {
              const Icon = TYPE_ICONS[lesson.type];
              const badge = LESSON_STATUS_BADGE[lesson.status];
              const selected = lesson.id === selectedId;
              return (
                <li key={lesson.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(lesson.id)}
                    aria-current={selected ? 'true' : undefined}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-start',
                      'transition-colors duration-fast ease-standard',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80',
                      selected
                        ? 'border-primary-400/60 bg-primary-soft shadow-sm'
                        : 'border-transparent hover:border-border hover:bg-surface-subtle',
                    )}
                  >
                    <Icon
                      aria-hidden="true"
                      className={cn('size-4 shrink-0', selected ? 'text-primary' : 'text-muted')}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          'block truncate text-sm',
                          selected ? 'font-semibold text-foreground' : 'text-foreground/90',
                        )}
                      >
                        {lesson.title}
                      </span>
                      {lesson.durationMin !== undefined && (
                        <span className="block text-2xs tabular-nums text-muted">
                          {t('duration', { minutes: lesson.durationMin })}
                        </span>
                      )}
                    </span>
                    <Badge variant={badge.variant} className="shrink-0">
                      {badge.label}
                    </Badge>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </nav>
  );
}
