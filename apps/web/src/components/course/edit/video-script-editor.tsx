'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, Film, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react';
import { Button, useToast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/error-message';
import { useDirtyState, confirmDiscardIfDirty } from './use-dirty-state';
import { useAutosave, autosaveStatusLabel } from '@/hooks/use-autosave';
import { clearLocalDraft, readLocalDraft, shouldOfferRecovery, writeLocalDraft } from '@/hooks/local-draft';
import { VersionHistoryPanel } from './version-history-panel';
import { SlideImagePanel } from './slide-image-panel';
import { SlideAudioPanel } from './slide-audio-panel';
import type { EditableSlide } from './types';

/** Gabarits qui affichent un panneau latéral illustré (miroir de media/slide-renderer.ts, SLIDE_ILLUSTRATION_TEMPLATES). */
const ILLUSTRATED_TEMPLATES = new Set(['content', 'recap']);

/**
 * Éditeur de script vidéo — une carte par slide (titre, puces, narration
 * éditables + réordonnancement). Sauvegarde le script via PATCH
 * /api/lessons/[id] puis « Régénérer cette vidéo » relance la production
 * (POST /api/lessons/[id]/regenerate, mode 'full' : script édité → re-TTS).
 * Autosave débouncée (P131) + brouillon local de secours.
 */
export interface VideoScriptEditorProps {
  courseId: string;
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

export function VideoScriptEditor({ courseId, lessonId, initialSlides, onExit }: VideoScriptEditorProps) {
  const router = useRouter();
  const t = useTranslations('course.editor');
  const tApiError = useTranslations('apiErrors');
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
  const [applyingMedia, setApplyingMedia] = React.useState(false);

  const dirty = useDirtyState(slides, baseline);

  React.useEffect(() => {
    if (dirty) writeLocalDraft(draftScope, slides);
    else clearLocalDraft(draftScope);
  }, [dirty, slides, draftScope]);

  const exit = () => {
    if (confirmDiscardIfDirty(dirty, t('discardConfirm'))) onExit();
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
        title: t('video.savedTitle'),
        description: t('video.savedDesc'),
        variant: 'success',
      });
      router.refresh();
      return true;
    } catch {
      toast({
        title: t('saveErrorTitle'),
        description: t('saveErrorDesc'),
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
          title: t('video.regenStartedTitle'),
          description: t('video.regenStartedDesc'),
          variant: 'success',
        });
        router.refresh();
        onExit();
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({
          title: t('video.regenErrorTitle'),
          description: errorMessage(data, tApiError),
          variant: 'danger',
        });
      }
    } catch {
      toast({ title: t('networkError'), description: t('serverUnreachable'), variant: 'danger' });
    } finally {
      setRegenerating(false);
    }
  };

  /**
   * Applique les changements de médias par slide (image régénérée/remplacée —
   * Lot 3, audio manuel enregistré/uploadé — Lot 4) à la vidéo déjà rendue,
   * sans repasser par le LLM ni retoucher script/narration texte.
   */
  const applyMediaToVideo = async () => {
    setApplyingMedia(true);
    try {
      const res = await fetch(`/api/lessons/${lessonId}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'render-only' }),
      });
      if (res.ok) {
        toast({
          title: t('video.applyMediaStartedTitle'),
          description: t('video.applyMediaStartedDesc'),
          variant: 'success',
        });
        router.refresh();
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({
          title: t('video.applyMediaErrorTitle'),
          description: errorMessage(data, tApiError),
          variant: 'danger',
        });
      }
    } catch {
      toast({ title: t('networkError'), description: t('serverUnreachable'), variant: 'danger' });
    } finally {
      setApplyingMedia(false);
    }
  };

  const autosaveLabel = autosaveStatusLabel(autosave.status, autosave.lastSavedAt, {
    saving: t('saving'),
    error: t('autosaveError'),
    savedAt: (time) => t('autosaveSavedAt', { time }),
  });

  return (
    <div className="flex flex-col gap-4">
      {recovered && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          {t('recoveredDraft')}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-muted">
          <Film className="size-3.5 text-primary" aria-hidden="true" />
          {t('video.titleWithCount', { count: slides.length })}
          {dirty && <span className="ms-1 text-accent-500 normal-case tracking-normal">• {t('unsaved')}</span>}
          {!dirty && autosaveLabel && (
            <span className="ms-1 text-muted normal-case tracking-normal">• {autosaveLabel}</span>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <VersionHistoryPanel lessonId={lessonId} />
          <Button variant="ghost" size="sm" onClick={exit}>
            <X aria-hidden="true" />
            {t('close')}
          </Button>
          <Button variant="secondary" size="sm" loading={saving} disabled={!dirty} onClick={save}>
            {!saving && <Save aria-hidden="true" />}
            {t('save')}
          </Button>
          <Button variant="secondary" size="sm" loading={applyingMedia} onClick={applyMediaToVideo}>
            <RefreshCw aria-hidden="true" />
            {t('video.applyMedia')}
          </Button>
          <Button size="sm" loading={regenerating} onClick={regenerate}>
            <Film aria-hidden="true" />
            {t('video.regenerate')}
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
                {t('video.slideLabel', { number: index + 1, template: slide.template })}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={t('video.moveUp')}
                  disabled={index === 0}
                  onClick={() => setSlides((prev) => move(prev, index, index - 1))}
                >
                  <ArrowUp aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={t('video.moveDown')}
                  disabled={index === slides.length - 1}
                  onClick={() => setSlides((prev) => move(prev, index, index + 1))}
                >
                  <ArrowDown aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-danger hover:bg-danger/10"
                  aria-label={t('video.deleteSlide')}
                  disabled={slides.length <= 2}
                  onClick={() => setSlides((prev) => prev.filter((_, i) => i !== index))}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            </div>

            <FieldLabel htmlFor={`slide-title-${index}`}>{t('video.fieldTitle')}</FieldLabel>
            <input
              id={`slide-title-${index}`}
              value={slide.title}
              onChange={(event) => patchSlide(index, { title: event.target.value })}
              className={inputClass}
            />

            <div className="flex flex-col gap-2">
              <FieldLabel>{t('video.bullets')}</FieldLabel>
              {slide.bullets.length === 0 && (
                <p className="text-xs text-muted">{t('video.noBullets')}</p>
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
                    aria-label={t('video.deleteBullet')}
                    onClick={() => removeBullet(index, bulletIndex)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              ))}
              <Button variant="ghost" size="sm" className="w-fit" onClick={() => addBullet(index)}>
                <Plus aria-hidden="true" />
                {t('video.addBullet')}
              </Button>
            </div>

            <FieldLabel htmlFor={`slide-narration-${index}`}>{t('video.narration')}</FieldLabel>
            <textarea
              id={`slide-narration-${index}`}
              value={slide.narration}
              onChange={(event) => patchSlide(index, { narration: event.target.value })}
              rows={3}
              className={cn(inputClass, 'resize-y leading-relaxed')}
            />

            {ILLUSTRATED_TEMPLATES.has(slide.template) && (
              <SlideImagePanel courseId={courseId} lessonId={lessonId} index={index} />
            )}
            <SlideAudioPanel courseId={courseId} lessonId={lessonId} index={index} />
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
