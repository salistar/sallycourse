'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ImageOff, Trash2, Upload } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, useToast } from '@/components/ui';
import { errorMessage } from '@/lib/error-message';

/**
 * Galerie de captures d'écran — grille responsive d'images présignées.
 * Mode par défaut (lecture) : chaque vignette s'ouvre en pleine taille dans
 * un nouvel onglet. Mode éditable (Lot 5, plan 2026-07-20, prop `editable`) :
 * rend EXACTEMENT `totalSteps` vignettes, alignées par index sur les étapes
 * du TP (une capture manquante = vignette vide avec bouton d'upload), avec
 * Remplacer/Supprimer par vignette — via
 * POST/DELETE /api/courses/[id]/lessons/[lessonId]/screenshots.
 */
export interface ScreenshotGalleryProps {
  /** URLs présignées, dans l'ordre de capture (chaîne vide = pas de capture à cet index, mode éditable). */
  screenshots: string[];
  /** Titre de la leçon (textes alternatifs). */
  lessonTitle: string;
  className?: string;
  editable?: {
    courseId: string;
    lessonId: string;
    /** Nombre d'étapes du TP — force le rendu de ce nombre exact de vignettes. */
    totalSteps: number;
  };
}

const ACCEPTED = 'image/png,image/jpeg,image/webp';

export function ScreenshotGallery({ screenshots, lessonTitle, className, editable }: ScreenshotGalleryProps) {
  if (editable) {
    return (
      <EditableScreenshotGallery
        screenshots={screenshots}
        lessonTitle={lessonTitle}
        className={className}
        courseId={editable.courseId}
        lessonId={editable.lessonId}
        totalSteps={editable.totalSteps}
      />
    );
  }

  const populated = screenshots.filter(Boolean);
  if (populated.length === 0) {
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
      {populated.map((url, index) => (
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
              Capture {index + 1} / {populated.length}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function EditableScreenshotGallery({
  screenshots,
  lessonTitle,
  className,
  courseId,
  lessonId,
  totalSteps,
}: {
  screenshots: string[];
  lessonTitle: string;
  className?: string;
  courseId: string;
  lessonId: string;
  totalSteps: number;
}) {
  const t = useTranslations('course.screenshotGallery');
  const tApiError = useTranslations('apiErrors');
  const router = useRouter();
  const { toast } = useToast();
  const [busyIndex, setBusyIndex] = React.useState<number | null>(null);
  const fileInputRefs = React.useRef<Record<number, HTMLInputElement | null>>({});

  const endpoint = `/api/courses/${courseId}/lessons/${lessonId}/screenshots`;

  const upload = React.useCallback(
    async (index: number, file: File) => {
      setBusyIndex(index);
      try {
        const form = new FormData();
        form.set('file', file);
        form.set('index', String(index));
        const res = await fetch(endpoint, { method: 'POST', body: form });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          toast({ title: t('failedTitle'), description: errorMessage(data, tApiError), variant: 'danger' });
          return;
        }
        toast({ title: t('savedTitle'), variant: 'success' });
        router.refresh();
      } catch {
        toast({ title: t('networkErrorTitle'), description: t('networkErrorDescription'), variant: 'danger' });
      } finally {
        setBusyIndex(null);
      }
    },
    [endpoint, router, toast, t, tApiError],
  );

  const remove = React.useCallback(
    async (index: number) => {
      setBusyIndex(index);
      try {
        const res = await fetch(`${endpoint}?index=${index}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          toast({ title: t('failedTitle'), description: errorMessage(data, tApiError), variant: 'danger' });
          return;
        }
        router.refresh();
      } catch {
        toast({ title: t('networkErrorTitle'), description: t('networkErrorDescription'), variant: 'danger' });
      } finally {
        setBusyIndex(null);
      }
    },
    [endpoint, router, toast, t, tApiError],
  );

  const slots = Array.from({ length: totalSteps }, (_, i) => screenshots[i] || '');

  return (
    <ul
      className={cn('m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3', className)}
      aria-label={`Captures d'écran — ${lessonTitle}`}
    >
      {slots.map((url, index) => (
        <li
          key={index}
          className="overflow-hidden rounded-md border border-border bg-surface-subtle"
        >
          {url ? (
            <div className="relative">
              {/* URL S3 présignée, hors optimiseur Next : <img> natif nécessaire. */}
              <img
                src={url}
                alt={`${t('stepAlt', { number: index + 1 })} — ${lessonTitle}`}
                loading="lazy"
                className="aspect-video w-full object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-neutral-950/70 px-2 py-1.5 backdrop-blur-sm">
                <span className="text-2xs font-medium uppercase tracking-wide text-neutral-100">
                  {t('stepAlt', { number: index + 1 })}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-neutral-100 hover:bg-white/10"
                    aria-label={t('replace')}
                    disabled={busyIndex === index}
                    onClick={() => fileInputRefs.current[index]?.click()}
                  >
                    <Upload className="size-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-danger hover:bg-danger/20"
                    aria-label={t('remove')}
                    disabled={busyIndex === index}
                    onClick={() => void remove(index)}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={busyIndex === index}
              onClick={() => fileInputRefs.current[index]?.click()}
              className={cn(
                'flex aspect-video w-full flex-col items-center justify-center gap-1.5 border-2 border-dashed border-border',
                'text-muted transition-colors duration-fast ease-standard hover:border-ring/60 hover:text-foreground',
              )}
            >
              <ImageOff className="size-5" aria-hidden="true" />
              <span className="text-2xs font-medium uppercase tracking-wide">{t('stepAlt', { number: index + 1 })}</span>
              <span className="text-2xs">{t('add')}</span>
            </button>
          )}
          <input
            ref={(el) => {
              fileInputRefs.current[index] = el;
            }}
            type="file"
            accept={ACCEPTED}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void upload(index, file);
            }}
          />
        </li>
      ))}
    </ul>
  );
}
