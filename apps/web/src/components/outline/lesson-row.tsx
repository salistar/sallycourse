'use client';

import * as React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { Clock, FileText, FlaskConical, GripVertical, HelpCircle, Trash2, Video, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { LESSON_TYPE_VALUES } from '@/lib/outline-payload';
import { sortableTransformStyle } from './sortable-style';
import type { EditorLesson, LessonType } from './types';

/**
 * Ligne de leçon éditable de l'éditeur de plan : poignée de drag, titre
 * renommable inline, type modifiable (select natif) et durée éditable.
 */

const TYPE_ICONS: Record<LessonType, LucideIcon> = {
  video: Video,
  article: FileText,
  tp: FlaskConical,
  quiz: HelpCircle,
};

export const LESSON_TYPE_LABELS: Record<LessonType, string> = {
  video: 'Vidéo',
  article: 'Article',
  tp: 'TP',
  quiz: 'Quiz',
};

export interface LessonRowProps {
  lesson: EditorLesson;
  index: number;
  onChange: (patch: Partial<Omit<EditorLesson, 'key'>>) => void;
  onRemove: () => void;
  /** Suppression bloquée (dernière leçon de la section). */
  removeDisabled?: boolean;
}

export function LessonRow({ lesson, index, onChange, onRemove, removeDisabled = false }: LessonRowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: lesson.key });

  const Icon = TYPE_ICONS[lesson.type];

  return (
    <li
      ref={setNodeRef}
      style={sortableTransformStyle(transform, transition)}
      className={cn(
        'group/lesson flex items-center gap-2 rounded-md border border-transparent bg-surface px-2 py-1.5',
        'transition-colors duration-fast ease-standard hover:border-border hover:bg-surface-subtle',
        isDragging && 'z-10 border-primary-400/60 bg-primary-soft opacity-90 shadow-md',
      )}
    >
      {/* Poignée de drag */}
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label={`Déplacer la leçon « ${lesson.title || `Leçon ${index + 1}`} »`}
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

      <Icon aria-hidden="true" className="size-4 shrink-0 text-muted" />

      {/* Titre — renommage inline */}
      <input
        type="text"
        value={lesson.title}
        onChange={(event) => onChange({ title: event.target.value })}
        aria-label={`Titre de la leçon ${index + 1}`}
        placeholder="Titre de la leçon"
        className={cn(
          'h-8 min-w-0 flex-1 rounded-sm border border-transparent bg-transparent px-2 text-sm text-foreground',
          'transition-colors duration-fast ease-standard placeholder:text-muted/60',
          'hover:border-border focus:border-primary focus:bg-surface focus:outline-none focus:ring-2 focus:ring-ring/35',
        )}
      />

      {/* Type de leçon */}
      <select
        value={lesson.type}
        onChange={(event) => onChange({ type: event.target.value as LessonType })}
        aria-label={`Type de la leçon ${index + 1}`}
        className={cn(
          'h-8 w-24 shrink-0 cursor-pointer appearance-none rounded-sm border border-border bg-surface px-2 text-xs text-foreground shadow-sm',
          'transition-colors duration-fast ease-standard hover:border-ring/50',
          'focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/35',
        )}
      >
        {LESSON_TYPE_VALUES.map((type) => (
          <option key={type} value={type}>
            {LESSON_TYPE_LABELS[type]}
          </option>
        ))}
      </select>

      {/* Durée estimée (minutes) */}
      <label className="flex shrink-0 items-center gap-1 text-2xs text-muted">
        <Clock className="size-3.5" aria-hidden="true" />
        <input
          type="number"
          min={1}
          max={600}
          value={lesson.durationMin}
          onChange={(event) => {
            const value = Number(event.target.value);
            onChange({ durationMin: Number.isFinite(value) ? value : 0 });
          }}
          aria-label={`Durée en minutes de la leçon ${index + 1}`}
          className={cn(
            'h-8 w-16 rounded-sm border border-border bg-surface px-2 text-end text-xs tabular-nums text-foreground shadow-sm',
            'transition-colors duration-fast ease-standard hover:border-ring/50',
            'focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/35',
          )}
        />
        min
      </label>

      {/* Suppression */}
      <button
        type="button"
        onClick={onRemove}
        disabled={removeDisabled}
        aria-label={`Supprimer la leçon ${index + 1}`}
        title={removeDisabled ? 'Une section doit garder au moins une leçon' : 'Supprimer la leçon'}
        className={cn(
          'shrink-0 rounded-sm p-1.5 text-muted/60 opacity-0 transition-all duration-fast',
          'group-hover/lesson:opacity-100 focus-visible:opacity-100',
          'hover:bg-danger/10 hover:text-danger',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80',
          'disabled:pointer-events-none disabled:opacity-0',
        )}
      >
        <Trash2 className="size-4" aria-hidden="true" />
      </button>
    </li>
  );
}
