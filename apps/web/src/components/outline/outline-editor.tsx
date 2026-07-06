'use client';

import * as React from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui';
import { SortableSection } from './sortable-section';
import type { EditorLesson, EditorSection } from './types';

/**
 * Éditeur de plan drag-and-drop (statut 'outline-review') : sections
 * réordonnables, leçons réordonnables et déplaçables ENTRE sections
 * (pattern multi-conteneurs : transfert pendant le survol, ordre au drop).
 */

export interface OutlineEditorProps {
  sections: EditorSection[];
  setSections: React.Dispatch<React.SetStateAction<EditorSection[]>>;
  /** Fabrique de clés dnd-kit pour les éléments ajoutés. */
  nextKey: () => string;
}

/** Index de la section contenant la leçon `lessonKey` (-1 si absente). */
function sectionIndexOfLesson(sections: EditorSection[], lessonKey: string): number {
  return sections.findIndex((section) => section.lessons.some((lesson) => lesson.key === lessonKey));
}

export function OutlineEditor({ sections, setSections, nextKey }: OutlineEditorProps) {
  const sensors = useSensors(
    // Seuil de 6 px : le clic dans les inputs/selects reste un clic.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const sectionKeys = React.useMemo(() => sections.map((section) => section.key), [sections]);
  const isSectionKey = React.useCallback(
    (id: string) => sectionKeys.includes(id),
    [sectionKeys],
  );

  // ── Drag : transfert d'une leçon vers une autre section au survol ──
  const handleDragOver = React.useCallback(
    ({ active, over }: DragOverEvent) => {
      if (!over) return;
      const activeId = String(active.id);
      const overId = String(over.id);
      if (activeId === overId || isSectionKey(activeId)) return;

      setSections((prev) => {
        const fromIndex = sectionIndexOfLesson(prev, activeId);
        const toIndex = isSectionKey(overId)
          ? prev.findIndex((section) => section.key === overId)
          : sectionIndexOfLesson(prev, overId);
        if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return prev;

        const fromSection = prev[fromIndex];
        const toSection = prev[toIndex];
        if (!fromSection || !toSection) return prev;

        const lesson = fromSection.lessons.find((item) => item.key === activeId);
        if (!lesson) return prev;

        const overLessonIndex = toSection.lessons.findIndex((item) => item.key === overId);
        const insertAt = overLessonIndex === -1 ? toSection.lessons.length : overLessonIndex;
        const toLessons = [...toSection.lessons];
        toLessons.splice(insertAt, 0, lesson);

        return prev.map((section, sectionIndex) => {
          if (sectionIndex === fromIndex) {
            return { ...section, lessons: section.lessons.filter((item) => item.key !== activeId) };
          }
          if (sectionIndex === toIndex) return { ...section, lessons: toLessons };
          return section;
        });
      });
    },
    [isSectionKey, setSections],
  );

  // ── Drop : ordre final (sections entre elles, leçons dans leur section) ──
  const handleDragEnd = React.useCallback(
    ({ active, over }: DragEndEvent) => {
      if (!over) return;
      const activeId = String(active.id);
      const overId = String(over.id);
      if (activeId === overId) return;

      setSections((prev) => {
        if (prev.some((section) => section.key === activeId)) {
          // Section déposée : si le survol pointe une leçon, viser sa section parente.
          const fromIndex = prev.findIndex((section) => section.key === activeId);
          const toIndex = prev.some((section) => section.key === overId)
            ? prev.findIndex((section) => section.key === overId)
            : sectionIndexOfLesson(prev, overId);
          if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return prev;
          return arrayMove(prev, fromIndex, toIndex);
        }

        // Leçon déposée : réordonner dans sa section courante (le transfert
        // inter-sections a déjà eu lieu pendant le survol).
        const sectionIndex = sectionIndexOfLesson(prev, activeId);
        const section = prev[sectionIndex];
        if (!section) return prev;
        const fromIndex = section.lessons.findIndex((lesson) => lesson.key === activeId);
        const toIndex = section.lessons.findIndex((lesson) => lesson.key === overId);
        if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return prev;
        return prev.map((item, itemIndex) =>
          itemIndex === sectionIndex
            ? { ...item, lessons: arrayMove(item.lessons, fromIndex, toIndex) }
            : item,
        );
      });
    },
    [setSections],
  );

  // ── Actions d'édition ──────────────────────────────────────────
  const renameSection = (sectionKey: string, title: string) =>
    setSections((prev) =>
      prev.map((section) => (section.key === sectionKey ? { ...section, title } : section)),
    );

  const removeSection = (sectionKey: string) =>
    setSections((prev) => prev.filter((section) => section.key !== sectionKey));

  const addSection = () =>
    setSections((prev) => [
      ...prev,
      {
        key: nextKey(),
        title: `Nouvelle section ${prev.length + 1}`,
        lessons: [{ key: nextKey(), title: 'Nouvelle leçon', type: 'video', durationMin: 5 }],
      },
    ]);

  const addLesson = (sectionKey: string) =>
    setSections((prev) =>
      prev.map((section) =>
        section.key === sectionKey
          ? {
              ...section,
              lessons: [
                ...section.lessons,
                { key: nextKey(), title: 'Nouvelle leçon', type: 'video' as const, durationMin: 5 },
              ],
            }
          : section,
      ),
    );

  const changeLesson = (sectionKey: string, lessonKey: string, patch: Partial<Omit<EditorLesson, 'key'>>) =>
    setSections((prev) =>
      prev.map((section) =>
        section.key === sectionKey
          ? {
              ...section,
              lessons: section.lessons.map((lesson) =>
                lesson.key === lessonKey ? { ...lesson, ...patch } : lesson,
              ),
            }
          : section,
      ),
    );

  const removeLesson = (sectionKey: string, lessonKey: string) =>
    setSections((prev) =>
      prev.map((section) =>
        section.key === sectionKey
          ? { ...section, lessons: section.lessons.filter((lesson) => lesson.key !== lessonKey) }
          : section,
      ),
    );

  return (
    <div className="flex flex-col gap-4">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={sectionKeys} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-4">
            {sections.map((section, index) => (
              <SortableSection
                key={section.key}
                section={section}
                index={index}
                onRename={(title) => renameSection(section.key, title)}
                onRemove={() => removeSection(section.key)}
                onAddLesson={() => addLesson(section.key)}
                onLessonChange={(lessonKey, patch) => changeLesson(section.key, lessonKey, patch)}
                onLessonRemove={(lessonKey) => removeLesson(section.key, lessonKey)}
                removeDisabled={sections.length <= 1}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <Button variant="secondary" onClick={addSection} className="w-full border-dashed">
        <Plus aria-hidden="true" />
        Ajouter une section
      </Button>
    </div>
  );
}
