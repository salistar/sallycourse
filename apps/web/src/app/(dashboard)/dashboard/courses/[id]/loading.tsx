import { Skeleton } from '@/components/ui';

/**
 * Squelette de la page détail — reflète la structure finale (en-tête,
 * arborescence à gauche, panneau de prévisualisation à droite) pour un
 * chargement sans saut de mise en page.
 */
export default function CourseDetailLoading() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-label="Chargement du cours">
      {/* En-tête : retour, titre + badge, métadonnées, actions */}
      <div className="flex flex-col gap-4">
        <Skeleton className="h-4 w-40" />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-72 max-w-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-8 w-28" />
          </div>
        </div>
      </div>

      {/* Corps : arborescence + panneau */}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(280px,340px)_1fr]">
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <Skeleton className="h-4 w-32" />
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
          <Skeleton className="mt-2 h-4 w-28" />
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={`b-${i}`} className="h-12 w-full" />
          ))}
        </div>

        <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-64 max-w-full" />
            </div>
            <Skeleton className="h-8 w-44" />
          </div>
          <div className="flex gap-2 border-b border-border pb-2">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-24" />
          </div>
          <Skeleton className="aspect-video w-full" />
        </div>
      </div>
    </div>
  );
}
