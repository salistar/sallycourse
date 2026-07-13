import type { CourseStatus } from '@sallycourse/shared';

// Pure — pas de directive 'use client' : importé à la fois par course-grid.tsx
// (client) et dashboard/page.tsx (server component). Une fonction définie dans
// un module 'use client' ne peut pas être appelée directement depuis un
// composant serveur (React la traite comme une référence client, pas un
// simple export), d'où l'extraction dans ce fichier séparé.

export type CourseFilterId = 'all' | 'active' | 'ready' | 'published' | 'draft';

export const FILTERS: { id: CourseFilterId; label: string; statuses?: CourseStatus[] }[] = [
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
