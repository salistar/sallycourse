'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, FlaskConical, Plus, Save, Trash2, X } from 'lucide-react';
import { Button, useToast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useDirtyState, confirmDiscardIfDirty } from './use-dirty-state';
import { useAutosave, autosaveStatusLabel } from '@/hooks/use-autosave';
import { clearLocalDraft, readLocalDraft, shouldOfferRecovery, writeLocalDraft } from '@/hooks/local-draft';
import { VersionHistoryPanel } from './version-history-panel';
import type { EditableTpStep } from './types';

/**
 * Éditeur de TP (Lot 5, plan 2026-07-20) — objectif, environnement, étapes
 * (instruction/commande/résultat attendu, add/remove/réordonner), validation,
 * dépannage. Sauvegarde via PATCH /api/lessons/[id] {tp}. Les captures
 * d'écran par étape sont un asset SÉPARÉ, éditées indépendamment (voir
 * ScreenshotGallery éditable dans lesson-panel.tsx) — ce composant ne touche
 * jamais aux images. Autosave débouncée (P131) + brouillon local de secours,
 * même patron que VideoScriptEditor/ArticleEditor.
 */
export interface TpEditorProps {
  lessonId: string;
  initialObjective: string;
  initialEnvironment: string[];
  initialSteps: EditableTpStep[];
  initialValidation: string[];
  initialTroubleshooting: string[];
  onExit: () => void;
}

const MIN_STEPS = 3;

interface TpFormState {
  objective: string;
  environment: string[];
  steps: EditableTpStep[];
  validation: string[];
  troubleshooting: string[];
}

function move<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

export function TpEditor({
  lessonId,
  initialObjective,
  initialEnvironment,
  initialSteps,
  initialValidation,
  initialTroubleshooting,
  onExit,
}: TpEditorProps) {
  const router = useRouter();
  const t = useTranslations('course.editor');
  const _tApiError = useTranslations('apiErrors');
  const { toast } = useToast();
  const draftScope = `tp:${lessonId}`;

  const initial: TpFormState = {
    objective: initialObjective,
    environment: initialEnvironment,
    steps: initialSteps,
    validation: initialValidation,
    troubleshooting: initialTroubleshooting,
  };

  const [form, setForm] = React.useState<TpFormState>(() => {
    const draft = readLocalDraft<TpFormState>(draftScope);
    if (draft && shouldOfferRecovery(draft, initial)) return draft.value;
    return initial;
  });
  const [recovered] = React.useState(() => {
    const draft = readLocalDraft<TpFormState>(draftScope);
    return Boolean(draft && shouldOfferRecovery(draft, initial));
  });
  const [baseline, setBaseline] = React.useState<TpFormState>(initial);
  const [saving, setSaving] = React.useState(false);

  const dirty = useDirtyState(form, baseline);

  React.useEffect(() => {
    if (dirty) writeLocalDraft(draftScope, form);
    else clearLocalDraft(draftScope);
  }, [dirty, form, draftScope]);

  const exit = () => {
    if (confirmDiscardIfDirty(dirty, t('discardConfirm'))) onExit();
  };

  const persist = React.useCallback(
    async (value: TpFormState) => {
      const cleaned: TpFormState = {
        objective: value.objective.trim(),
        environment: value.environment.map((e) => e.trim()).filter(Boolean),
        steps: value.steps.map((s) => ({
          ...s,
          instruction: s.instruction.trim(),
          command: s.command.trim(),
          expectedResult: s.expectedResult.trim(),
        })),
        validation: value.validation.map((v) => v.trim()).filter(Boolean),
        troubleshooting: value.troubleshooting.map((tr) => tr.trim()).filter(Boolean),
      };
      const payloadSteps = cleaned.steps.map(({ rest, command, ...edited }) => ({
        ...rest,
        ...edited,
        ...(command ? { command } : {}),
      }));
      const res = await fetch(`/api/lessons/${lessonId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tp: {
            objective: cleaned.objective,
            environment: cleaned.environment,
            steps: payloadSteps,
            validation: cleaned.validation,
            troubleshooting: cleaned.troubleshooting,
          },
        }),
      });
      if (!res.ok) throw new Error('save-failed');
      setForm(cleaned);
      setBaseline(cleaned);
      clearLocalDraft(draftScope);
    },
    [lessonId, draftScope],
  );

  const autosave = useAutosave(form, persist, { enabled: dirty });

  const save = async (): Promise<boolean> => {
    setSaving(true);
    try {
      await persist(form);
      toast({ title: t('tp.savedTitle'), description: t('tp.savedDesc'), variant: 'success' });
      router.refresh();
      return true;
    } catch {
      toast({ title: t('saveErrorTitle'), description: t('saveErrorDesc'), variant: 'danger' });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const autosaveLabel = autosaveStatusLabel(autosave.status, autosave.lastSavedAt, {
    saving: t('saving'),
    error: t('autosaveError'),
    savedAt: (time) => t('autosaveSavedAt', { time }),
  });

  // ── Listes de chaînes (environnement / validation / dépannage) ──────────
  const setListItem = (key: 'environment' | 'validation' | 'troubleshooting', index: number, value: string) => {
    setForm((prev) => ({ ...prev, [key]: prev[key].map((v, i) => (i === index ? value : v)) }));
  };
  const addListItem = (key: 'environment' | 'validation' | 'troubleshooting') => {
    setForm((prev) => ({ ...prev, [key]: [...prev[key], ''] }));
  };
  const removeListItem = (key: 'environment' | 'validation' | 'troubleshooting', index: number) => {
    setForm((prev) => ({ ...prev, [key]: prev[key].filter((_, i) => i !== index) }));
  };

  // ── Étapes ───────────────────────────────────────────────────────────
  const patchStep = (index: number, patch: Partial<EditableTpStep>) => {
    setForm((prev) => ({
      ...prev,
      steps: prev.steps.map((step, i) => (i === index ? { ...step, ...patch } : step)),
    }));
  };
  const addStep = () => {
    setForm((prev) => ({
      ...prev,
      steps: [...prev.steps, { instruction: '', command: '', expectedResult: '', rest: {} }],
    }));
  };
  const removeStep = (index: number) => {
    setForm((prev) => ({ ...prev, steps: prev.steps.filter((_, i) => i !== index) }));
  };

  return (
    <div className="flex flex-col gap-4">
      {recovered && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          {t('recoveredDraft')}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-muted">
          <FlaskConical className="size-3.5 text-primary" aria-hidden="true" />
          {t('tp.title')}
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
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <FieldLabel htmlFor={`tp-objective-${lessonId}`}>{t('tp.objective')}</FieldLabel>
        <textarea
          id={`tp-objective-${lessonId}`}
          value={form.objective}
          onChange={(event) => setForm((prev) => ({ ...prev, objective: event.target.value }))}
          rows={2}
          className={cn(inputClass, 'resize-y leading-relaxed')}
        />
      </div>

      <StringListEditor
        title={t('tp.environment')}
        items={form.environment}
        emptyHint={t('tp.noEnvironment')}
        addLabel={t('tp.addEnvironment')}
        deleteLabel={t('tp.deleteEnvironment')}
        onChange={(i, v) => setListItem('environment', i, v)}
        onAdd={() => addListItem('environment')}
        onRemove={(i) => removeListItem('environment', i)}
      />

      <div className="flex flex-col gap-3">
        <p className="text-2xs font-semibold uppercase tracking-wide text-muted">
          {t('tp.steps', { count: form.steps.length })}
        </p>
        <ol className="m-0 flex list-none flex-col gap-4 p-0">
          {form.steps.map((step, index) => (
            <li
              key={index}
              className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4 shadow-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-2xs font-semibold uppercase tracking-wide text-muted">
                  {t('tp.stepLabel', { number: index + 1 })}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={t('tp.moveUp')}
                    disabled={index === 0}
                    onClick={() => setForm((prev) => ({ ...prev, steps: move(prev.steps, index, index - 1) }))}
                  >
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={t('tp.moveDown')}
                    disabled={index === form.steps.length - 1}
                    onClick={() => setForm((prev) => ({ ...prev, steps: move(prev.steps, index, index + 1) }))}
                  >
                    <ArrowDown aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-danger hover:bg-danger/10"
                    aria-label={t('tp.deleteStep')}
                    disabled={form.steps.length <= MIN_STEPS}
                    onClick={() => removeStep(index)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              </div>

              <FieldLabel htmlFor={`tp-instruction-${lessonId}-${index}`}>{t('tp.instruction')}</FieldLabel>
              <textarea
                id={`tp-instruction-${lessonId}-${index}`}
                value={step.instruction}
                onChange={(event) => patchStep(index, { instruction: event.target.value })}
                rows={2}
                className={cn(inputClass, 'resize-y leading-relaxed')}
              />

              <FieldLabel htmlFor={`tp-command-${lessonId}-${index}`}>{t('tp.command')}</FieldLabel>
              <input
                id={`tp-command-${lessonId}-${index}`}
                value={step.command}
                onChange={(event) => patchStep(index, { command: event.target.value })}
                placeholder={t('tp.commandPlaceholder')}
                className={cn(inputClass, 'font-mono text-xs')}
              />

              <FieldLabel htmlFor={`tp-expected-${lessonId}-${index}`}>{t('tp.expectedResult')}</FieldLabel>
              <textarea
                id={`tp-expected-${lessonId}-${index}`}
                value={step.expectedResult}
                onChange={(event) => patchStep(index, { expectedResult: event.target.value })}
                rows={2}
                className={cn(inputClass, 'resize-y leading-relaxed')}
              />
            </li>
          ))}
        </ol>
        <Button variant="ghost" size="sm" className="w-fit" onClick={addStep}>
          <Plus aria-hidden="true" />
          {t('tp.addStep')}
        </Button>
      </div>

      <StringListEditor
        title={t('tp.validation')}
        items={form.validation}
        emptyHint={t('tp.noValidation')}
        addLabel={t('tp.addValidation')}
        deleteLabel={t('tp.deleteValidation')}
        onChange={(i, v) => setListItem('validation', i, v)}
        onAdd={() => addListItem('validation')}
        onRemove={(i) => removeListItem('validation', i)}
      />

      <StringListEditor
        title={t('tp.troubleshooting')}
        items={form.troubleshooting}
        emptyHint={t('tp.noTroubleshooting')}
        addLabel={t('tp.addTroubleshooting')}
        deleteLabel={t('tp.deleteTroubleshooting')}
        onChange={(i, v) => setListItem('troubleshooting', i, v)}
        onAdd={() => addListItem('troubleshooting')}
        onRemove={(i) => removeListItem('troubleshooting', i)}
      />
    </div>
  );
}

/** Sous-éditeur générique d'une liste de chaînes (environnement/validation/dépannage). */
function StringListEditor({
  title,
  items,
  emptyHint,
  addLabel,
  deleteLabel,
  onChange,
  onAdd,
  onRemove,
}: {
  title: string;
  items: string[];
  emptyHint: string;
  addLabel: string;
  deleteLabel: string;
  onChange: (index: number, value: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-2xs font-semibold uppercase tracking-wide text-muted">{title}</p>
      {items.length === 0 && <p className="text-xs text-muted">{emptyHint}</p>}
      {items.map((item, index) => (
        <div key={index} className="flex items-center gap-2">
          <input value={item} onChange={(event) => onChange(index, event.target.value)} className={inputClass} />
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-danger hover:bg-danger/10"
            aria-label={deleteLabel}
            onClick={() => onRemove(index)}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      ))}
      <Button variant="ghost" size="sm" className="w-fit" onClick={onAdd}>
        <Plus aria-hidden="true" />
        {addLabel}
      </Button>
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
