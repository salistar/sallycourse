'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Check, CheckCircle2, RotateCcw, Sparkles, X, XCircle } from 'lucide-react';
import { Button, Progress, useToast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/error-message';
import type { GamificationAwardView, LearnQuizQuestionView } from './types';

/**
 * Quiz interactif du LMS étudiant, enrichi (Prompt 145) : à la soumission, les
 * questions ratées sont envoyées à /api/learn/[courseId]/progress?event=track
 * (LessonProgress.wrongAnswers) pour alimenter le générateur d'exercices
 * ciblés. Un bouton « Plus d'exercices » appelle ensuite
 * /api/lms/lessons/[id]/more-exercises et affiche les questions générées.
 *
 * P200 : /track renvoie le delta d'XP à la PREMIÈRE soumission (5/10/20 XP
 * selon le score, + 10 XP de leçon terminée, + bonus quotidien éventuel).
 * `onXpAwarded` le remonte au HUD ; une re-soumission ne rapporte plus rien
 * (la route détecte la leçon déjà complétée) et remonte donc `null`.
 */
export interface LearnQuizPlayerProps {
  courseId: string;
  lessonId: string;
  /** Titre de la leçon — sert de thème par défaut faute de thème par question. */
  lessonTitle: string;
  questions: LearnQuizQuestionView[];
  /** Remonte le gain d'XP renvoyé par /track (null si aucun XP attribué). */
  onXpAwarded?: (award: GamificationAwardView | null) => void;
  className?: string;
}

interface GeneratedExercise {
  targetedThemes: string[];
  questions: LearnQuizQuestionView[];
}

export function LearnQuizPlayer({
  courseId,
  lessonId,
  lessonTitle,
  questions,
  onXpAwarded,
  className,
}: LearnQuizPlayerProps) {
  const { toast } = useToast();
  const t = useTranslations('learn.quiz');
  const tApiError = useTranslations('apiErrors');
  const total = questions.length;
  const [answers, setAnswers] = React.useState<(number | null)[]>(() =>
    Array.from({ length: total }, () => null),
  );
  const [submitted, setSubmitted] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);
  const [exercise, setExercise] = React.useState<GeneratedExercise | null>(null);

  const ready = answers.every((a) => a !== null);
  const correctCount = answers.filter((a, i) => a === questions[i]?.correctIndex).length;
  const percent = total > 0 ? Math.round((correctCount / total) * 100) : 0;

  const select = (questionIndex: number, choiceIndex: number) => {
    if (submitted) return;
    setAnswers((prev) => {
      const next = [...prev];
      next[questionIndex] = choiceIndex;
      return next;
    });
  };

  async function submit() {
    if (!ready || submitted) return;
    setSubmitted(true);

    // Questions ratées → thème (à défaut d'un thème par question dans le
    // schéma officiel, on retient le titre de la leçon comme thème unique).
    const wrongAnswers = questions
      .map((q, i) => ({ q, picked: answers[i]! }))
      .filter(({ q, picked }) => picked !== q.correctIndex)
      .map(({ q, picked }) => ({
        question: q.question,
        theme: lessonTitle,
        pickedIndex: picked,
        correctIndex: q.correctIndex,
      }));

    try {
      const res = await fetch(`/api/learn/${courseId}/track`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          lessonId,
          event: 'completed',
          quizScore: percent,
          wrongAnswers,
        }),
      });
      if (res.ok && onXpAwarded) {
        // P200 : `gamification` est null si la leçon avait déjà été complétée
        // (aucun XP à la re-soumission) — le HUD ne bouge alors pas.
        const data = (await res.json()) as { gamification: GamificationAwardView | null };
        onXpAwarded(data.gamification);
      }
    } catch {
      // Best-effort — l'échec du tracking ne bloque jamais l'affichage du score.
    }
  }

  function restart() {
    setAnswers(Array.from({ length: total }, () => null));
    setSubmitted(false);
    setExercise(null);
  }

  async function requestMoreExercises() {
    setGenerating(true);
    try {
      const res = await fetch(`/api/lms/lessons/${lessonId}/more-exercises`, { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as Partial<GeneratedExercise> & { error?: string };
      if (!res.ok) {
        toast({
          title: t('errorGenTitle'),
          description: errorMessage(data, tApiError),
          variant: 'danger',
        });
        return;
      }
      setExercise({ targetedThemes: data.targetedThemes ?? [], questions: data.questions ?? [] });
    } catch {
      toast({ title: t('errorGenTitle'), description: t('errorNetwork'), variant: 'danger' });
    } finally {
      setGenerating(false);
    }
  }

  if (total === 0) {
    return <p className="text-sm text-muted">{t('emptyQuiz')}</p>;
  }

  const answeredCount = answers.filter((a) => a !== null).length;
  const hasMistakes = submitted && correctCount < total;

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      {submitted ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface-subtle p-6 text-center">
          <p className="text-2xs font-semibold uppercase tracking-wide text-muted">{t('resultLabel')}</p>
          <p className="font-display text-4xl font-semibold text-foreground">
            {correctCount}
            <span className="text-muted"> / {total}</span>
          </p>
          <Progress value={percent} label={t('correctAnswersLabel')} showLabel className="max-w-xs" />
          <p
            className={cn(
              'flex items-center gap-2 text-sm font-semibold',
              percent >= 70 ? 'text-success' : 'text-danger',
            )}
          >
            {percent >= 70 ? (
              <>
                <CheckCircle2 className="size-4" aria-hidden="true" /> {t('quizPassed')}
              </>
            ) : (
              <>
                <XCircle className="size-4" aria-hidden="true" /> {t('belowThreshold')}
              </>
            )}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button variant="secondary" size="sm" onClick={restart}>
              <RotateCcw aria-hidden="true" />
              {t('restart')}
            </Button>
            {hasMistakes && (
              <Button size="sm" onClick={requestMoreExercises} disabled={generating}>
                <Sparkles aria-hidden="true" />
                {generating ? t('generating') : t('moreExercises')}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-2xs font-semibold uppercase tracking-wide text-muted">
            {t('progress', { answered: answeredCount, total })}
          </p>
          <Progress value={(answeredCount / total) * 100} label={t('quizProgressLabel')} className="max-w-[12rem]" />
        </div>
      )}

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
                          !submitted &&
                            (isPicked
                              ? 'border-primary/60 bg-primary-soft/50'
                              : 'border-border bg-surface hover:border-ring/60 hover:bg-surface-subtle'),
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
              {submitted && question.explanation && (
                <p className="rounded-md border border-border bg-surface-subtle p-3 text-sm text-muted">
                  <span className="font-semibold text-foreground">{t('explanationLabel')}</span>
                  {question.explanation}
                </p>
              )}
            </li>
          );
        })}
      </ol>

      {!submitted && (
        <div>
          <Button onClick={submit} disabled={!ready}>
            <CheckCircle2 aria-hidden="true" />
            {t('submit')}
          </Button>
          {!ready && (
            <p className="mt-2 text-2xs text-muted">{t('answerAllPrompt')}</p>
          )}
        </div>
      )}

      {/* Exercices personnalisés générés à la demande (P145) */}
      {exercise && exercise.questions.length > 0 && (
        <div className="flex flex-col gap-4 rounded-lg border border-accent-400/40 bg-accent-50/40 p-5">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-accent-600" aria-hidden="true" />
            <p className="text-sm font-semibold text-foreground">
              {t('personalizedExercises')}{' '}
              {exercise.targetedThemes.length > 0 && (
                <span className="font-normal text-muted">{t('targetedOn', { themes: exercise.targetedThemes.join(', ') })}</span>
              )}
            </p>
          </div>
          <ol className="m-0 flex list-none flex-col gap-5 p-0">
            {exercise.questions.map((q, i) => (
              <li key={i} className="flex flex-col gap-2">
                <p className="text-sm font-semibold text-foreground">
                  {i + 1}. {q.question}
                </p>
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {q.choices.map((choice, ci) => (
                    <li
                      key={ci}
                      className={cn(
                        'rounded-md border px-3 py-2 text-sm',
                        ci === q.correctIndex
                          ? 'border-success/60 bg-success/10 text-foreground'
                          : 'border-border text-muted',
                      )}
                    >
                      {String.fromCharCode(65 + ci)}. {choice}
                    </li>
                  ))}
                </ul>
                {q.explanation && <p className="text-xs text-muted">{q.explanation}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
