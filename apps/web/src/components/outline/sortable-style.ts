import type * as React from 'react';

/** Transform minimal d'un élément sortable (forme de @dnd-kit/core). */
interface SortableTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
}

/**
 * Équivalent local de `CSS.Transform.toString` de @dnd-kit/utilities —
 * paquet non déclaré en dépendance directe (pnpm strict), on évite de
 * l'importer pour trois lignes.
 */
export function sortableTransformStyle(
  transform: SortableTransform | null,
  transition: string | undefined,
): React.CSSProperties {
  return {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0) scaleX(${transform.scaleX}) scaleY(${transform.scaleY})`
      : undefined,
    transition,
  };
}
