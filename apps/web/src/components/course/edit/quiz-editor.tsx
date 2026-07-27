'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { HelpCircle, Plus, Save, Trash2, X } from 'lucide-react';
import { Button, useToast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useDirtyState, confirmDiscardIfDirty } from './use-dirty-state';
import { useAutosave, autosaveStatusLabel } from '@/hooks/use-autosave';
import { clearLocalDraft, readLocalDraft, shouldOfferRecovery, writeLocalDraft } from '@/hooks/local-draft';
import { VersionHistoryPanel } from './version-history-panel';
import type { EditableQuizQuestion } from './types';

/**
 * Éditeur de quiz — liste de questions (intitulé, 4 choix, bonne réponse via
 * radio, explication) avec ajout/suppression. Sauvegarde via
 * PATCH /api/quiz/[lessonId]. La leçon n'a pas d'asset média dérivé : seule
 * la donnée quiz est mise à jour. Autosave débouncée (P131) + brouillon
 * local de secours.
 */

/** Nombre de choix par question (aligné sur QUIZ.CHOICES_PER_QUESTION). */
const CHOICES_PER_QUESTION = 4;

export interface QuizEditorProps {
  lessonId: string;
  initialQuestions: EditableQuizQuestion[];
  onExit: () => void;
}

/** Question vierge (4 choix vides, bonne réponse = premier choix). */
function emptyQuestion(): EditableQuizQuestion {
  return {
    question: '',
    choices: Array.from({ length: CHOICES_PER_QUESTION }, () => ''),
    correctIndex: 0,
    explanation: '',
  };
}

export function QuizEditor({ lessonId, initialQuestions, onExit }: QuizEditorProps) {
  const router = useRouter();
  const t = useTranslations('course.editor');
  const { toast } = useToast();
  const draftScope = `quiz:${lessonId}`;
  const initialQuestionsOrEmpty = initialQuestions.length > 0 ? initialQuestions : [emptyQuestion()];

  const [questions, setQuestions] = React.useState<EditableQuizQuestion[]>(() => {
    const draft = readLocalDraft<EditableQuizQuestion[]>(draftScope);
    if (draft && shouldOfferRecovery(draft, initialQuestionsOrEmpty)) return draft.value;
    return initialQuestionsOrEmpty;
  });
  const [recovered] = React.useState(() => {
    const draft = readLocalDraft<EditableQuizQuestion[]>(draftScope);
    return Boolean(draft && shouldOfferRecovery(draft, initialQuestionsOrEmpty));
  });
  const [baseline, setBaseline] = React.useState<EditableQuizQuestion[]>(questions);
  const [saving, setSaving] = React.useState(false);

  const dirty = useDirtyState(questions, baseline);

  React.useEffect(() => {
    if (dirty) writeLocalDraft(draftScope, questions);
    else clearLocalDraft(draftScope);
  }, [dirty, questions, draftScope]);

  const exit = () => {
    if (confirmDiscardIfDirty(dirty, t('discardConfirm'))) onExit();
  };

  const patchQuestion = (index: number, patch: Partial<EditableQuizQuestion>) => {
    setQuestions((prev) => prev.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  };

  const setChoice = (qIndex: number, cIndex: number, value: string) => {
    setQuestions((prev) =>
      prev.map((q, i) =>
        i === qIndex ? { ...q, choices: q.choices.map((c, j) => (j === cIndex ? value : c)) } : q,
      ),
    );
  };

  /** Validation locale avant envoi (miroir léger de quizQuestionSchema). */
  const validate = (): string | null => {
    if (questions.length === 0) return t('quiz.vAtLeastOne');
    for (let i = 0; i < questions.length; i += 1) {
      const q = questions[i]!;
      if (!q.question.trim()) return t('quiz.vEmptyTitle', { number: i + 1 });
      if (q.choices.length !== CHOICES_PER_QUESTION)
        return t('quiz.vChoicesCount', { number: i + 1, count: CHOICES_PER_QUESTION });
      if (q.choices.some((c) => !c.trim())) return t('quiz.vChoicesFilled', { number: i + 1 });
      if (q.correctIndex < 0 || q.correctIndex >= CHOICES_PER_QUESTION)
        return t('quiz.vInvalidCorrect', { number: i + 1 });
    }
    return null;
  };

  /** Sauvegarde silencieuse (sans toast) — réutilisée par l'autosave. */
  const persist = React.useCallback(
    async (value: EditableQuizQuestion[]) => {
      const res = await fetch(`/api/quiz/${lessonId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questions: value.map((q) => ({
            question: q.question.trim(),
            choices: q.choices.map((c) => c.trim()),
            correctIndex: q.correctIndex,
            explanation: q.explanation.trim(),
          })),
        }),
      });
      if (!res.ok) throw new Error('save-failed');
      setBaseline(value);
      clearLocalDraft(draftScope);
    },
    [lessonId, draftScope],
  );

  // Autosave désactivée tant que le quiz est incomplet — évite un cycle
  // d'échecs silencieux contre la validation serveur (miroir de `validate`).
  const autosave = useAutosave(questions, persist, { enabled: dirty && validate() === null });

  const save = async () => {
    const error = validate();
    if (error) {
      toast({ title: t('quiz.incompleteTitle'), description: error, variant: 'danger' });
      return;
    }
    setSaving(true);
    try {
      await persist(questions);
      toast({ title: t('quiz.savedTitle'), description: t('quiz.savedDesc'), variant: 'success' });
      router.refresh();
    } catch {
      toast({
        title: t('saveErrorTitle'),
        description: t('saveErrorDesc'),
        variant: 'danger',
      });
    } finally {
      setSaving(false);
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
          <HelpCircle className="size-3.5 text-primary" aria-hidden="true" />
          {t('quiz.titleWithCount', { count: questions.length })}
          {dirty && <span className="ms-1 text-accent-500 normal-case tracking-normal">• {t('unsaved')}</span>}
          {!dirty && autosaveLabel && (
            <span className="ms-1 text-muted normal-case tracking-normal">• {autosaveLabel}</span>
          )}
        </p>
        <div className="flex items-center gap-2">
          <VersionHistoryPanel lessonId={lessonId} />
          <Button variant="ghost" size="sm" onClick={exit}>
            <X aria-hidden="true" />
            {t('close')}
          </Button>
          <Button size="sm" loading={saving} disabled={!dirty} onClick={save}>
            {!saving && <Save aria-hidden="true" />}
            {t('save')}
          </Button>
        </div>
      </div>

      <ol className="m-0 flex list-none flex-col gap-4 p-0">
        {questions.map((question, qIndex) => (
          <li
            key={qIndex}
            className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4 shadow-sm"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-2xs font-semibold uppercase tracking-wide text-muted">
                {t('quiz.questionLabel', { number: qIndex + 1 })}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-danger hover:bg-danger/10"
                aria-label={t('quiz.deleteQuestion')}
                disabled={questions.length <= 1}
                onClick={() => setQuestions((prev) => prev.filter((_, i) => i !== qIndex))}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>

            <textarea
              value={question.question}
              onChange={(event) => patchQuestion(qIndex, { question: event.target.value })}
              rows={2}
              placeholder={t('quiz.questionPlaceholder')}
              className={cn(inputClass, 'resize-y')}
            />

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-2xs font-semibold uppercase tracking-wide text-muted">
                {t('quiz.choicesLegend')}
              </legend>
              {question.choices.map((choice, cIndex) => {
                const isCorrect = question.correctIndex === cIndex;
                return (
                  <div key={cIndex} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={`correct-${qIndex}`}
                      checked={isCorrect}
                      onChange={() => patchQuestion(qIndex, { correctIndex: cIndex })}
                      aria-label={t('quiz.markCorrect', { letter: String.fromCharCode(65 + cIndex) })}
                      className="size-4 shrink-0 accent-[var(--color-success)]"
                    />
                    <span
                      aria-hidden="true"
                      className="w-4 shrink-0 text-2xs font-semibold text-muted"
                    >
                      {String.fromCharCode(65 + cIndex)}
                    </span>
                    <input
                      value={choice}
                      onChange={(event) => setChoice(qIndex, cIndex, event.target.value)}
                      placeholder={t('quiz.choicePlaceholder', { letter: String.fromCharCode(65 + cIndex) })}
                      className={cn(
                        inputClass,
                        isCorrect && 'border-success/60 bg-success/5',
                      )}
                    />
                  </div>
                );
              })}
            </fieldset>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={`explanation-${qIndex}`}
                className="text-2xs font-semibold uppercase tracking-wide text-muted"
              >
                {t('quiz.explanation')}
              </label>
              <textarea
                id={`explanation-${qIndex}`}
                value={question.explanation}
                onChange={(event) => patchQuestion(qIndex, { explanation: event.target.value })}
                rows={2}
                placeholder={t('quiz.explanationPlaceholder')}
                className={cn(inputClass, 'resize-y')}
              />
            </div>
          </li>
        ))}
      </ol>

      <Button
        variant="secondary"
        size="sm"
        className="w-fit"
        onClick={() => setQuestions((prev) => [...prev, emptyQuestion()])}
      >
        <Plus aria-hidden="true" />
        {t('quiz.addQuestion')}
      </Button>
    </div>
  );
}

const inputClass = cn(
  'w-full rounded-sm border border-input bg-surface px-3 py-2',
  'text-sm text-foreground shadow-sm transition-colors duration-fast ease-standard',
  'hover:border-ring/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/35',
);
