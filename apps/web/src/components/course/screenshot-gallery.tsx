'use client';

import { ImageOff } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Galerie de captures d'écran — grille responsive d'images présignées.
 * Chaque vignette s'ouvre en pleine taille dans un nouvel onglet (les URLs
 * S3 présignées expirent : pas de copie durable, juste la consultation).
 */
export interface ScreenshotGalleryProps {
  /** URLs présignées, dans l'ordre de capture. */
  screenshots: string[];
  /** Titre de la leçon (textes alternatifs). */
  lessonTitle: string;
  className?: string;
}

export function ScreenshotGallery({ screenshots, lessonTitle, className }: ScreenshotGalleryProps) {
  if (screenshots.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <ImageOff className="size-4" aria-hidden="true" />
        Aucune capture disponible pour cette leçon.
      </p>
    );
  }

  return (
    <ul
      className={cn('m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3', className)}
      aria-label={`Captures d'écran — ${lessonTitle}`}
    >
      {screenshots.map((url, index) => (
        <li key={url}>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title="Ouvrir en pleine taille"
            className={cn(
              'group block overflow-hidden rounded-md border border-border bg-surface-subtle',
              'transition-all duration-fast ease-standard hover:border-ring/60 hover:shadow-md',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80',
            )}
          >
            {/* URLs S3 présignées, hors optimiseur Next : <img> natif nécessaire. */}
            <img
              src={url}
              alt={`Capture ${index + 1} — ${lessonTitle}`}
              loading="lazy"
              className="aspect-video w-full object-cover transition-transform duration-base ease-standard group-hover:scale-[1.02]"
            />
            <span className="block px-3 py-1.5 text-2xs font-medium uppercase tracking-wide text-muted">
              Capture {index + 1} / {screenshots.length}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
