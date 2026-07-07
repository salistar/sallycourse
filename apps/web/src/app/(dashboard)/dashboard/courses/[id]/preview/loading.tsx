import { Skeleton } from '@/components/ui';

/**
 * Squelette de l'aperçu étudiant (P60) — reflète la structure finale (en-tête,
 * barre de progression, plan à gauche, lecteur à droite) pour éviter tout saut
 * de mise en page pendant la présignature des assets côté serveur.
 */
export default function CoursePreviewLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Chargement de l’aperçu">
      {/* En-tête */}
      <div className="flex flex-col gap-4">
        <Skeleton className="h-4 w-32" />
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-6 w-32 rounded-full" />
          <Skeleton className="h-8 w-72 max-w-full" />
        </div>
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      {/* Barre de progression */}
      <Skeleton className="h-20 w-full rounded-lg" />

      {/* Plan + lecteur */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_1fr]">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-28" />
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-64 max-w-full" />
            </div>
            <Skeleton className="h-8 w-40" />
          </div>
          <Skeleton className="aspect-video w-full" />
          <div className="flex items-center justify-between">
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-8 w-28" />
          </div>
        </div>
      </div>
    </div>
  );
}
