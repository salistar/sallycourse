'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { HelpCircle, Plus, Save, Trash2, X } from 'lucide-react';
import { Button, useToast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useDirtyState, confirmDiscardIfDirty } from './use-dirty-state';
import type { EditableQuizQuestion } from './types';

/**
 * Éditeur de quiz — liste de questions (intitulé, 4 choix, bonne réponse via
 * radio, explication) avec ajout/suppression. Sauvegarde via
 * PATCH /api/quiz/[lessonId]. La leçon n'a pas d'asset média dérivé : seule
 * la donnée quiz est mise à jour.
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
  const { toast } = useToast();
  const [questions, setQuestions] = React.useState<EditableQuizQuestion[]>(
    initialQuestions.length > 0 ? initialQuestions : [emptyQuestion()],
  );
  const [baseline, setBaseline] = React.useState<EditableQuizQuestion[]>(questions);
  const [saving, setSaving] = React.useState(false);

  const dirty = useDirtyState(questions, baseline);

  const exit = () => {
    if (confirmDiscardIfDirty(dirty)) onExit();
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
    if (questions.length === 0) return 'Le quiz doit contenir au moins une question.';
    for (let i = 0; i < questions.length; i += 1) {
      const q = questions[i]!;
      if (!q.question.trim()) return `Question ${i + 1} : l’intitulé est vide.`;
      if (q.choices.length !== CHOICES_PER_QUESTION) return `Question ${i + 1} : ${CHOICES_PER_QUESTION} choix requis.`;
      if (q.choices.some((c) => !c.trim())) return `Question ${i + 1} : tous les choix doivent être renseignés.`;
      if (q.correctIndex < 0 || q.correctIndex >= CHOICES_PER_QUESTION)
        return `Question ${i + 1} : bonne réponse invalide.`;
    }
    return null;
  };

  const save = async () => {
    const error = validate();
    if (error) {
      toast({ title: 'Quiz incomplet', description: error, variant: 'danger' });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/quiz/${lessonId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questions: questions.map((q) => ({
            question: q.question.trim(),
            choices: q.choices.map((c) => c.trim()),
            correctIndex: q.correctIndex,
            explanation: q.explanation.trim(),
          })),
        }),
      });
      if (res.ok) {
        setBaseline(questions);
        toast({ title: 'Quiz enregistré', description: 'Les questions ont été mises à jour.', variant: 'success' });
        router.refresh();
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({
          title: 'Enregistrement impossible',
          description: data?.error ?? 'Une erreur est survenue, réessayez plus tard.',
          variant: 'danger',
        });
      }
    } catch {
      toast({ title: 'Erreur réseau', description: 'Impossible de joindre le serveur.', variant: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-muted">
          <HelpCircle className="size-3.5 text-primary" aria-hidden="true" />
          Édition du quiz · {questions.length} question{questions.length > 1 ? 's' : ''}
          {dirty && <span className="ms-1 text-accent-500 normal-case tracking-normal">• non enregistré</span>}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={exit}>
            <X aria-hidden="true" />
            Fermer
          </Button>
          <Button size="sm" loading={saving} disabled={!dirty} onClick={save}>
            {!saving && <Save aria-hidden="true" />}
            Enregistrer
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
                Question {qIndex + 1}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-danger hover:bg-danger/10"
                aria-label="Supprimer la question"
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
              placeholder="Intitulé de la question"
              className={cn(inputClass, 'resize-y')}
            />

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-2xs font-semibold uppercase tracking-wide text-muted">
                Choix (cochez la bonne réponse)
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
                      aria-label={`Marquer le choix ${String.fromCharCode(65 + cIndex)} comme bonne réponse`}
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
                      placeholder={`Choix ${String.fromCharCode(65 + cIndex)}`}
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
                Explication
              </label>
              <textarea
                id={`explanation-${qIndex}`}
                value={question.explanation}
                onChange={(event) => patchQuestion(qIndex, { explanation: event.target.value })}
                rows={2}
                placeholder="Pourquoi cette réponse est correcte"
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
        Ajouter une question
      </Button>
    </div>
  );
}

const inputClass = cn(
  'w-full rounded-sm border border-input bg-surface px-3 py-2',
  'text-sm text-foreground shadow-sm transition-colors duration-fast ease-standard',
  'hover:border-ring/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/35',
);
