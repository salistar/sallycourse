'use client';

import * as React from 'react';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui';
import { cn } from '@/lib/cn';
import { LessonRow } from './lesson-row';
import { sortableTransformStyle } from './sortable-style';
import type { EditorLesson, EditorSection } from './types';

/**
 * Carte de section de l'éditeur de plan : sortable (réordonnable entre
 * sections), titre renommable inline, liste de leçons elle-même sortable
 * (contexte imbriqué) et actions ajouter/supprimer.
 */

export interface SortableSectionProps {
  section: EditorSection;
  index: number;
  onRename: (title: string) => void;
  onRemove: () => void;
  onAddLesson: () => void;
  onLessonChange: (lessonKey: string, patch: Partial<Omit<EditorLesson, 'key'>>) => void;
  onLessonRemove: (lessonKey: string) => void;
  /** Suppression bloquée (dernière section du plan). */
  removeDisabled?: boolean;
}

export function SortableSection({
  section,
  index,
  onRename,
  onRemove,
  onAddLesson,
  onLessonChange,
  onLessonRemove,
  removeDisabled = false,
}: SortableSectionProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: section.key });

  const lessonKeys = React.useMemo(() => section.lessons.map((lesson) => lesson.key), [section.lessons]);

  return (
    <section
      ref={setNodeRef}
      style={sortableTransformStyle(transform, transition)}
      aria-label={section.title || `Section ${index + 1}`}
      className={cn(
        'rounded-lg border border-border bg-surface shadow-sm',
        'transition-colors duration-fast ease-standard',
        isDragging && 'z-20 border-primary-400/60 opacity-90 shadow-xl',
      )}
    >
      {/* ── En-tête de section ─────────────────────────────────── */}
      <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <button
          ref={setActivatorNodeRef}
          type="button"
          aria-label={`Déplacer la section « ${section.title || `Section ${index + 1}`} »`}
          className={cn(
            'shrink-0 cursor-grab touch-none rounded-sm p-1 text-muted/60',
            'transition-colors duration-fast hover:bg-primary-soft hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80',
            'active:cursor-grabbing',
          )}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </button>

        <span className="shrink-0 text-sm font-semibold tabular-nums text-muted">{index + 1}.</span>

        <input
          type="text"
          value={section.title}
          onChange={(event) => onRename(event.target.value)}
          aria-label={`Titre de la section ${index + 1}`}
          placeholder="Titre de la section"
          className={cn(
            'h-9 min-w-0 flex-1 rounded-sm border border-transparent bg-transparent px-2',
            'font-display text-base font-semibold text-foreground',
            'transition-colors duration-fast ease-standard placeholder:font-sans placeholder:text-sm placeholder:font-normal placeholder:text-muted/60',
            'hover:border-border focus:border-primary focus:bg-surface-subtle focus:outline-none focus:ring-2 focus:ring-ring/35',
          )}
        />

        <span className="shrink-0 text-2xs font-medium uppercase tracking-wide text-muted">
          {section.lessons.length} leçon{section.lessons.length > 1 ? 's' : ''}
        </span>

        <button
          type="button"
          onClick={onRemove}
          disabled={removeDisabled}
          aria-label={`Supprimer la section ${index + 1}`}
          title={removeDisabled ? 'Le plan doit garder au moins une section' : 'Supprimer la section et ses leçons'}
          className={cn(
            'shrink-0 rounded-sm p-1.5 text-muted/60 transition-colors duration-fast',
            'hover:bg-danger/10 hover:text-danger',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80',
            'disabled:pointer-events-none disabled:opacity-40',
          )}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </button>
      </header>

      {/* ── Leçons (sortables, déplaçables entre sections) ─────── */}
      <SortableContext items={lessonKeys} strategy={verticalListSortingStrategy}>
        <ol className="m-0 flex list-none flex-col gap-0.5 p-2">
          {section.lessons.map((lesson, lessonIndex) => (
            <LessonRow
              key={lesson.key}
              lesson={lesson}
              index={lessonIndex}
              onChange={(patch) => onLessonChange(lesson.key, patch)}
              onRemove={() => onLessonRemove(lesson.key)}
              removeDisabled={section.lessons.length <= 1}
            />
          ))}
        </ol>
      </SortableContext>

      <footer className="px-2 pb-2">
        <Button variant="ghost" size="sm" onClick={onAddLesson} className="w-full justify-start">
          <Plus aria-hidden="true" />
          Ajouter une leçon
        </Button>
      </footer>
    </section>
  );
}
