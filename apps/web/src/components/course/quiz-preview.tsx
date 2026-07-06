'use client';

import * as React from 'react';
import { Check, CheckCircle2, RotateCcw, X, XCircle } from 'lucide-react';
import { Button, Progress } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { QuizQuestionView } from './types';

/**
 * Prévisualisation interactive d'un quiz — question par question :
 * choix cliquables, feedback immédiat bonne/mauvaise réponse + explication,
 * puis écran de score final avec possibilité de recommencer.
 */
export interface QuizPreviewProps {
  questions: QuizQuestionView[];
  className?: string;
}

export function QuizPreview({ questions, className }: QuizPreviewProps) {
  // Index de la question courante ; === questions.length → écran de score.
  const [index, setIndex] = React.useState(0);
  /** Choix verrouillé pour la question courante (null = pas encore répondu). */
  const [picked, setPicked] = React.useState<number | null>(null);
  const [correctCount, setCorrectCount] = React.useState(0);

  const total = questions.length;
  const finished = index >= total;

  const restart = () => {
    setIndex(0);
    setPicked(null);
    setCorrectCount(0);
  };

  const pick = (choiceIndex: number, correctIndex: number) => {
    if (picked !== null) return; // Réponse verrouillée.
    setPicked(choiceIndex);
    if (choiceIndex === correctIndex) setCorrectCount((n) => n + 1);
  };

  const next = () => {
    setPicked(null);
    setIndex((i) => i + 1);
  };

  if (total === 0) {
    return <p className="text-sm text-muted">Ce quiz ne contient encore aucune question.</p>;
  }

  // ── Écran de score final ──────────────────────────────────────
  if (finished) {
    const percent = Math.round((correctCount / total) * 100);
    const message =
      percent === 100
        ? 'Sans faute — le quiz est prêt à être publié.'
        : percent >= 60
          ? 'Bon niveau de difficulté pour vos apprenants.'
          : 'Quiz corsé — vérifiez les explications avant publication.';

    return (
      <div className={cn('flex flex-col items-center gap-4 py-8 text-center', className)}>
        <p className="text-2xs font-semibold uppercase tracking-wide text-muted">Score final</p>
        <p className="font-display text-4xl font-semibold text-foreground">
          {correctCount}
          <span className="text-muted"> / {total}</span>
        </p>
        <Progress value={percent} label="Bonnes réponses" showLabel className="max-w-xs" />
        <p className="max-w-sm text-sm text-muted">{message}</p>
        <Button variant="secondary" size="sm" onClick={restart}>
          <RotateCcw aria-hidden="true" />
          Recommencer le quiz
        </Button>
      </div>
    );
  }

  // ── Question courante ─────────────────────────────────────────
  const question = questions[index];
  if (!question) return null; // Garde défensive (index hors bornes).
  const answered = picked !== null;
  const isCorrect = answered && picked === question.correctIndex;

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-2xs font-semibold uppercase tracking-wide text-muted">
          Question {index + 1} / {total}
        </p>
        <span className="text-2xs tabular-nums text-muted">{correctCount} bonne(s) réponse(s)</span>
      </div>
      <Progress value={(index / total) * 100} label="Avancement du quiz" />

      <h4 className="font-display text-lg font-semibold text-foreground">{question.question}</h4>

      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {question.choices.map((choice, choiceIndex) => {
          const isRight = choiceIndex === question.correctIndex;
          const isPicked = choiceIndex === picked;
          return (
            <li key={choiceIndex}>
              <button
                type="button"
                onClick={() => pick(choiceIndex, question.correctIndex)}
                disabled={answered}
                aria-pressed={isPicked}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md border px-4 py-3 text-start text-sm',
                  'transition-colors duration-fast ease-standard',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80',
                  !answered && 'border-border bg-surface hover:border-ring/60 hover:bg-surface-subtle',
                  // Après réponse : la bonne réponse est toujours révélée.
                  answered && isRight && 'border-success/60 bg-success/10',
                  answered && isPicked && !isRight && 'border-danger/60 bg-danger/10',
                  answered && !isPicked && !isRight && 'border-border opacity-60',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-full border text-2xs font-semibold',
                    answered && isRight
                      ? 'border-success bg-success text-success-foreground'
                      : answered && isPicked
                        ? 'border-danger bg-danger text-danger-foreground'
                        : 'border-border bg-surface-subtle text-muted',
                  )}
                >
                  {answered && isRight ? (
                    <Check className="size-3.5" strokeWidth={3} />
                  ) : answered && isPicked ? (
                    <X className="size-3.5" strokeWidth={3} />
                  ) : (
                    String.fromCharCode(65 + choiceIndex)
                  )}
                </span>
                <span className="min-w-0 flex-1 text-foreground">{choice}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* Feedback + explication après verrouillage de la réponse */}
      {answered && (
        <div
          role="status"
          className={cn(
            'flex flex-col gap-1.5 rounded-md border p-4',
            isCorrect ? 'border-success/40 bg-success/5' : 'border-danger/40 bg-danger/5',
          )}
        >
          <p
            className={cn(
              'flex items-center gap-2 text-sm font-semibold',
              isCorrect ? 'text-success' : 'text-danger',
            )}
          >
            {isCorrect ? (
              <CheckCircle2 className="size-4" aria-hidden="true" />
            ) : (
              <XCircle className="size-4" aria-hidden="true" />
            )}
            {isCorrect ? 'Bonne réponse !' : 'Mauvaise réponse'}
          </p>
          {question.explanation && <p className="text-sm text-muted">{question.explanation}</p>}
          <div className="mt-2">
            <Button size="sm" onClick={next}>
              {index + 1 < total ? 'Question suivante' : 'Voir le score'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
