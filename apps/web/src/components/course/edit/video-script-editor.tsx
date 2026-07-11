'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, Film, Plus, Save, Trash2, X } from 'lucide-react';
import { Button, useToast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useDirtyState, confirmDiscardIfDirty } from './use-dirty-state';
import { useAutosave, autosaveStatusLabel } from '@/hooks/use-autosave';
import { clearLocalDraft, readLocalDraft, shouldOfferRecovery, writeLocalDraft } from '@/hooks/local-draft';
import { VersionHistoryPanel } from './version-history-panel';
import type { EditableSlide } from './types';

/**
 * Éditeur de script vidéo — une carte par slide (titre, puces, narration
 * éditables + réordonnancement). Sauvegarde le script via PATCH
 * /api/lessons/[id] puis « Régénérer cette vidéo » relance la production
 * (POST /api/lessons/[id]/regenerate, mode 'full' : script édité → re-TTS).
 * Autosave débouncée (P131) + brouillon local de secours.
 */
export interface VideoScriptEditorProps {
  lessonId: string;
  /** Slides initiales extraites de lesson.script. */
  initialSlides: EditableSlide[];
  onExit: () => void;
}

/** Déplace un élément d'un tableau (immutable). */
function move<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

export function VideoScriptEditor({ lessonId, initialSlides, onExit }: VideoScriptEditorProps) {
  const router = useRouter();
  const { toast } = useToast();
  const draftScope = `video-script:${lessonId}`;

  const [slides, setSlides] = React.useState<EditableSlide[]>(() => {
    const draft = readLocalDraft<EditableSlide[]>(draftScope);
    if (draft && shouldOfferRecovery(draft, initialSlides)) return draft.value;
    return initialSlides;
  });
  const [recovered] = React.useState(() => {
    const draft = readLocalDraft<EditableSlide[]>(draftScope);
    return Boolean(draft && shouldOfferRecovery(draft, initialSlides));
  });
  const [baseline, setBaseline] = React.useState<EditableSlide[]>(initialSlides);
  const [saving, setSaving] = React.useState(false);
  const [regenerating, setRegenerating] = React.useState(false);

  const dirty = useDirtyState(slides, baseline);

  React.useEffect(() => {
    if (dirty) writeLocalDraft(draftScope, slides);
    else clearLocalDraft(draftScope);
  }, [dirty, slides, draftScope]);

  const exit = () => {
    if (confirmDiscardIfDirty(dirty)) onExit();
  };

  /** Sauvegarde silencieuse (sans toast) — réutilisée par l'autosave. */
  const persist = React.useCallback(
    async (value: EditableSlide[]) => {
      const cleaned = value.map((slide) => ({
        ...slide,
        bullets: slide.bullets.map((b) => b.trim()).filter(Boolean),
      }));
      const payloadSlides = cleaned.map(({ rest, ...edited }) => ({ ...rest, ...edited }));
      const res = await fetch(`/api/lessons/${lessonId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script: { slides: payloadSlides } }),
      });
      if (!res.ok) throw new Error('save-failed');
      setSlides(cleaned);
      setBaseline(cleaned);
      clearLocalDraft(draftScope);
    },
    [lessonId, draftScope],
  );

  const autosave = useAutosave(slides, persist, { enabled: dirty });

  const patchSlide = (index: number, patch: Partial<EditableSlide>) => {
    setSlides((prev) => prev.map((slide, i) => (i === index ? { ...slide, ...patch } : slide)));
  };

  const setBullet = (slideIndex: number, bulletIndex: number, value: string) => {
    setSlides((prev) =>
      prev.map((slide, i) =>
        i === slideIndex
          ? { ...slide, bullets: slide.bullets.map((b, j) => (j === bulletIndex ? value : b)) }
          : slide,
      ),
    );
  };

  const addBullet = (slideIndex: number) => {
    setSlides((prev) =>
      prev.map((slide, i) => (i === slideIndex ? { ...slide, bullets: [...slide.bullets, ''] } : slide)),
    );
  };

  const removeBullet = (slideIndex: number, bulletIndex: number) => {
    setSlides((prev) =>
      prev.map((slide, i) =>
        i === slideIndex ? { ...slide, bullets: slide.bullets.filter((_, j) => j !== bulletIndex) } : slide,
      ),
    );
  };

  const save = async (): Promise<boolean> => {
    setSaving(true);
    try {
      await persist(slides);
      toast({
        title: 'Script enregistré',
        description: 'La vidéo actuelle est marquée obsolète — régénérez-la pour appliquer les changements.',
        variant: 'success',
      });
      router.refresh();
      return true;
    } catch {
      toast({
        title: 'Enregistrement impossible',
        description: 'Une erreur est survenue, réessayez plus tard. Votre brouillon reste sauvegardé localement.',
        variant: 'danger',
      });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const regenerate = async () => {
    // Un script édité mais non sauvegardé serait ignoré par le worker : on
    // sauvegarde d'abord si nécessaire.
    if (dirty) {
      const saved = await save();
      if (!saved) return;
    }
    setRegenerating(true);
    try {
      const res = await fetch(`/api/lessons/${lessonId}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'full' }),
      });
      if (res.ok) {
        toast({
          title: 'Régénération lancée',
          description: 'La vidéo repart en production à partir du script édité.',
          variant: 'success',
        });
        router.refresh();
        onExit();
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({
          title: 'Régénération impossible',
          description: data?.error ?? 'Une erreur est survenue, réessayez plus tard.',
          variant: 'danger',
        });
      }
    } catch {
      toast({ title: 'Erreur réseau', description: 'Impossible de joindre le serveur.', variant: 'danger' });
    } finally {
      setRegenerating(false);
    }
  };

  const autosaveLabel = autosaveStatusLabel(autosave.status, autosave.lastSavedAt);

  return (
    <div className="flex flex-col gap-4">
      {recovered && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          Un brouillon non synchronisé a été retrouvé sur cet appareil et rechargé — pensez à
          l’enregistrer.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-muted">
          <Film className="size-3.5 text-primary" aria-hidden="true" />
          Édition du script vidéo · {slides.length} slide{slides.length > 1 ? 's' : ''}
          {dirty && <span className="ms-1 text-accent-500 normal-case tracking-normal">• non enregistré</span>}
          {!dirty && autosaveLabel && (
            <span className="ms-1 text-muted normal-case tracking-normal">• {autosaveLabel}</span>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <VersionHistoryPanel lessonId={lessonId} />
          <Button variant="ghost" size="sm" onClick={exit}>
            <X aria-hidden="true" />
            Fermer
          </Button>
          <Button variant="secondary" size="sm" loading={saving} disabled={!dirty} onClick={save}>
            {!saving && <Save aria-hidden="true" />}
            Enregistrer
          </Button>
          <Button size="sm" loading={regenerating} onClick={regenerate}>
            <Film aria-hidden="true" />
            Régénérer cette vidéo
          </Button>
        </div>
      </div>

      <ol className="m-0 flex list-none flex-col gap-4 p-0">
        {slides.map((slide, index) => (
          <li
            key={index}
            className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4 shadow-sm"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-2xs font-semibold uppercase tracking-wide text-muted">
                Slide {index + 1} · {slide.template}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label="Monter la slide"
                  disabled={index === 0}
                  onClick={() => setSlides((prev) => move(prev, index, index - 1))}
                >
                  <ArrowUp aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label="Descendre la slide"
                  disabled={index === slides.length - 1}
                  onClick={() => setSlides((prev) => move(prev, index, index + 1))}
                >
                  <ArrowDown aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-danger hover:bg-danger/10"
                  aria-label="Supprimer la slide"
                  disabled={slides.length <= 2}
                  onClick={() => setSlides((prev) => prev.filter((_, i) => i !== index))}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            </div>

            <FieldLabel htmlFor={`slide-title-${index}`}>Titre</FieldLabel>
            <input
              id={`slide-title-${index}`}
              value={slide.title}
              onChange={(event) => patchSlide(index, { title: event.target.value })}
              className={inputClass}
            />

            <div className="flex flex-col gap-2">
              <FieldLabel>Puces</FieldLabel>
              {slide.bullets.length === 0 && (
                <p className="text-xs text-muted">Aucune puce — ajoutez-en si besoin.</p>
              )}
              {slide.bullets.map((bullet, bulletIndex) => (
                <div key={bulletIndex} className="flex items-center gap-2">
                  <input
                    value={bullet}
                    onChange={(event) => setBullet(index, bulletIndex, event.target.value)}
                    className={inputClass}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 text-danger hover:bg-danger/10"
                    aria-label="Supprimer la puce"
                    onClick={() => removeBullet(index, bulletIndex)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              ))}
              <Button variant="ghost" size="sm" className="w-fit" onClick={() => addBullet(index)}>
                <Plus aria-hidden="true" />
                Ajouter une puce
              </Button>
            </div>

            <FieldLabel htmlFor={`slide-narration-${index}`}>Narration</FieldLabel>
            <textarea
              id={`slide-narration-${index}`}
              value={slide.narration}
              onChange={(event) => patchSlide(index, { narration: event.target.value })}
              rows={3}
              className={cn(inputClass, 'resize-y leading-relaxed')}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

const inputClass = cn(
  'w-full rounded-sm border border-input bg-surface px-3 py-2',
  'text-sm text-foreground shadow-sm transition-colors duration-fast ease-standard',
  'hover:border-ring/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/35',
);

function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="text-2xs font-semibold uppercase tracking-wide text-muted">
      {children}
    </label>
  );
}
