'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Check, CheckCircle2, RotateCcw, X, XCircle } from 'lucide-react';
import { Button, Progress } from '@/components/ui';
import { cn } from '@/lib/cn';
import { allAnswered, gradeQuiz } from './preview-logic';
import type { PreviewQuizQuestion } from './types';

/**
 * Quiz interactif « façon Udemy » de la prévisualisation étudiante (Prompt 60).
 * Différence clé avec QuizPreview (P26, auteur) : l'étudiant répond à TOUTES les
 * questions d'abord, puis SOUMET. Les corrections et explications ne sont
 * révélées qu'APRÈS soumission, avec le score. « Recommencer » réinitialise.
 */
export interface QuizRunnerProps {
  questions: PreviewQuizQuestion[];
  /** Appelé une fois le quiz soumis (pour marquer la leçon comme vue). */
  onSubmitted?: (grade: { correct: number; total: number; percent: number; passed: boolean }) => void;
  className?: string;
}

export function QuizRunner({ questions, onSubmitted, className }: QuizRunnerProps) {
  const t = useTranslations('course.preview');
  const total = questions.length;
  // answers[i] = index du choix sélectionné, ou null si pas encore répondu.
  const [answers, setAnswers] = React.useState<(number | null)[]>(() =>
    Array.from({ length: total }, () => null),
  );
  const [submitted, setSubmitted] = React.useState(false);

  const correctIndexes = React.useMemo(() => questions.map((q) => q.correctIndex), [questions]);
  const ready = allAnswered(total, answers);
  const grade = React.useMemo(() => gradeQuiz(correctIndexes, answers), [correctIndexes, answers]);

  const select = (questionIndex: number, choiceIndex: number) => {
    if (submitted) return; // Réponses verrouillées après soumission.
    setAnswers((prev) => {
      const next = [...prev];
      next[questionIndex] = choiceIndex;
      return next;
    });
  };

  const submit = () => {
    if (!ready || submitted) return;
    setSubmitted(true);
    onSubmitted?.(grade);
  };

  const restart = () => {
    setAnswers(Array.from({ length: total }, () => null));
    setSubmitted(false);
  };

  if (total === 0) {
    return <p className="text-sm text-muted">{t('quizNoQuestions')}</p>;
  }

  const answeredCount = answers.filter((a) => a != null).length;

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      {/* Bandeau de score (après soumission) */}
      {submitted ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface-subtle p-6 text-center">
          <p className="text-2xs font-semibold uppercase tracking-wide text-muted">{t('quiz.result')}</p>
          <p className="font-display text-4xl font-semibold text-foreground">
            {grade.correct}
            <span className="text-muted"> / {grade.total}</span>
          </p>
          <Progress
            value={grade.percent}
            label={t('quiz.correctAnswers')}
            showLabel
            className="max-w-xs"
          />
          <p
            className={cn(
              'flex items-center gap-2 text-sm font-semibold',
              grade.passed ? 'text-success' : 'text-danger',
            )}
          >
            {grade.passed ? (
              <>
                <CheckCircle2 className="size-4" aria-hidden="true" /> {t('quiz.passed')}
              </>
            ) : (
              <>
                <XCircle className="size-4" aria-hidden="true" /> {t('quiz.belowThreshold')}
              </>
            )}
          </p>
          <Button variant="secondary" size="sm" onClick={restart}>
            <RotateCcw aria-hidden="true" />
            {t('quiz.restart')}
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-2xs font-semibold uppercase tracking-wide text-muted">
            {t('quiz.answeredProgress', { answered: answeredCount, total })}
          </p>
          <Progress value={(answeredCount / total) * 100} label={t('quiz.progressAria')} className="max-w-[12rem]" />
        </div>
      )}

      {/* Liste des questions */}
      <ol className="m-0 flex list-none flex-col gap-6 p-0">
        {questions.map((question, qi) => {
          const picked = answers[qi];
          return (
            <li key={qi} className="flex flex-col gap-3">
              <h4 className="font-display text-base font-semibold text-foreground">
                <span className="text-muted">{qi + 1}. </span>
                {question.question}
              </h4>

              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {question.choices.map((choice, ci) => {
                  const isRight = ci === question.correctIndex;
                  const isPicked = ci === picked;
                  return (
                    <li key={ci}>
                      <button
                        type="button"
                        onClick={() => select(qi, ci)}
                        disabled={submitted}
                        aria-pressed={isPicked}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-md border px-4 py-3 text-start text-sm',
                          'transition-colors duration-fast ease-standard',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80',
                          // Avant soumission : simple sélection.
                          !submitted &&
                            (isPicked
                              ? 'border-primary/60 bg-primary-soft/50'
                              : 'border-border bg-surface hover:border-ring/60 hover:bg-surface-subtle'),
                          // Après soumission : correction révélée.
                          submitted && isRight && 'border-success/60 bg-success/10',
                          submitted && isPicked && !isRight && 'border-danger/60 bg-danger/10',
                          submitted && !isPicked && !isRight && 'border-border opacity-60',
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            'flex size-6 shrink-0 items-center justify-center rounded-full border text-2xs font-semibold',
                            submitted && isRight
                              ? 'border-success bg-success text-success-foreground'
                              : submitted && isPicked
                                ? 'border-danger bg-danger text-danger-foreground'
                                : isPicked
                                  ? 'border-primary bg-primary text-primary-foreground'
                                  : 'border-border bg-surface-subtle text-muted',
                          )}
                        >
                          {submitted && isRight ? (
                            <Check className="size-3.5" strokeWidth={3} />
                          ) : submitted && isPicked ? (
                            <X className="size-3.5" strokeWidth={3} />
                          ) : (
                            String.fromCharCode(65 + ci)
                          )}
                        </span>
                        <span className="min-w-0 flex-1 text-foreground">{choice}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              {/* Explication révélée seulement APRÈS soumission */}
              {submitted && question.explanation && (
                <p className="rounded-md border border-border bg-surface-subtle p-3 text-sm text-muted">
                  <span className="font-semibold text-foreground">{t('quiz.explanationLabel')}</span>
                  {question.explanation}
                </p>
              )}
            </li>
          );
        })}
      </ol>

      {/* Soumission (une seule fois, si tout est répondu) */}
      {!submitted && (
        <div>
          <Button onClick={submit} disabled={!ready}>
            <CheckCircle2 aria-hidden="true" />
            {t('quiz.submit')}
          </Button>
          {!ready && (
            <p className="mt-2 text-2xs text-muted">
              {t('quiz.answerAllToSubmit')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
