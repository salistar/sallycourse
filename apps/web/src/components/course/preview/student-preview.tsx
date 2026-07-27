'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Circle,
  Download,
  Eye,
  FileText,
  FlaskConical,
  HelpCircle,
  PartyPopper,
  Video,
} from 'lucide-react';
import { Badge, Button, Card, CardContent, Progress } from '@/components/ui';
import { ArticleView } from '@/components/course/article-view';
import { cn } from '@/lib/cn';
import { localeDirection } from '@/i18n/routing';
import { QuizRunner } from './quiz-runner';
import {
  isPreviewFinished,
  nextLessonIndex,
  prevLessonIndex,
  previewProgressPercent,
} from './preview-logic';
import type { PreviewCourse, PreviewLesson } from './types';

/**
 * Prévisualisation « mode étudiant » d'un cours (Prompt 60). L'auteur parcourt
 * son cours comme un apprenant Udemy : plan à gauche, lecteur séquentiel au
 * centre (vidéo / article / quiz interactif), navigation Précédent / Suivant et
 * progression LOCALE (aucune inscription, aucune écriture serveur). RTL-ready :
 * le conteneur adopte la direction de la LANGUE DU COURS (indépendante de l'UI).
 */

const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  video: Video,
  article: FileText,
  tp: FlaskConical,
  quiz: HelpCircle,
};

/** Clé i18n du libellé de type (résolue via t() au rendu — pas de hook ici). */
const TYPE_LABEL_KEY: Record<string, string> = {
  video: 'typeVideo',
  article: 'typeArticle',
  tp: 'typeTp',
  quiz: 'typeQuiz',
};

export interface StudentPreviewProps {
  course: PreviewCourse;
}

export function StudentPreview({ course }: StudentPreviewProps) {
  const t = useTranslations('course.preview');
  const total = course.lessons.length;
  const [activeIndex, setActiveIndex] = React.useState(0);
  // Progression locale : ids des leçons « vues » pendant la session de preview.
  const [completed, setCompleted] = React.useState<Set<string>>(() => new Set());

  const active = course.lessons[activeIndex];
  const doneCount = completed.size;
  const percent = previewProgressPercent(doneCount, total);
  const finished = isPreviewFinished(doneCount, total);
  const dir = localeDirection(course.locale);

  // Leçons groupées par section pour le plan (respecte l'ordre serveur).
  const lessonsBySection = React.useMemo(() => {
    const map = new Map<string, { lesson: PreviewLesson; index: number }[]>();
    course.lessons.forEach((lesson, index) => {
      const arr = map.get(lesson.sectionId) ?? [];
      arr.push({ lesson, index });
      map.set(lesson.sectionId, arr);
    });
    return map;
  }, [course.lessons]);

  const markDone = React.useCallback((id: string) => {
    setCompleted((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const goTo = (index: number) => {
    if (index < 0 || index >= total) return;
    setActiveIndex(index);
  };

  const prevIndex = prevLessonIndex(activeIndex, total);
  const nextIndex = nextLessonIndex(activeIndex, total);

  return (
    <div className="flex flex-col gap-6">
      {/* ── En-tête ─────────────────────────────────────────────── */}
      <header className="flex flex-col gap-4">
        <Link
          href={`/dashboard/courses/${course.id}`}
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted transition-colors duration-fast hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t('backToCourse')}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 text-2xs font-semibold uppercase tracking-wide text-accent">
                <Eye className="size-3.5" aria-hidden="true" />
                {t('studentPreview')}
              </span>
              <h1 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">
                {course.title}
              </h1>
            </div>
            {course.summary && <p className="mt-2 max-w-2xl text-sm text-muted">{course.summary}</p>}
          </div>
        </div>
      </header>

      {/* ── Barre de progression locale ─────────────────────────── */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-medium text-foreground">
              {t('progressLabel', { done: doneCount, total })}
            </p>
            <span className="text-2xs text-muted">{t('localProgress')}</span>
          </div>
          <Progress value={percent} label={t('progressAria')} />
        </CardContent>
      </Card>

      {total === 0 ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted">{t('noLessons')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[300px_1fr]" dir={dir}>
          {/* Plan du cours */}
          <nav
            aria-label={t('planAria')}
            className="flex flex-col gap-4 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto"
          >
            {course.sections.map((section) => {
              const entries = lessonsBySection.get(section.id) ?? [];
              if (entries.length === 0) return null;
              return (
                <div key={section.id} className="flex flex-col gap-1.5">
                  <p className="px-2 text-2xs font-semibold uppercase tracking-wide text-muted">
                    {section.title}
                  </p>
                  <ul className="m-0 flex list-none flex-col gap-1 p-0">
                    {entries.map(({ lesson, index }) => {
                      const Icon = TYPE_ICON[lesson.type] ?? FileText;
                      const isActive = index === activeIndex;
                      const isDone = completed.has(lesson.id);
                      return (
                        <li key={lesson.id}>
                          <button
                            type="button"
                            onClick={() => goTo(index)}
                            className={cn(
                              'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-start text-sm',
                              'transition-colors duration-fast',
                              isActive
                                ? 'bg-primary-soft/60 text-foreground'
                                : 'text-muted hover:bg-surface-subtle hover:text-foreground',
                            )}
                            aria-current={isActive ? 'true' : undefined}
                          >
                            <span className="shrink-0">
                              {isDone ? (
                                <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
                              ) : (
                                <Circle className="size-4 text-muted" aria-hidden="true" />
                              )}
                            </span>
                            <Icon className="size-4 shrink-0" aria-hidden="true" />
                            <span className="min-w-0 flex-1 truncate">{lesson.title}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </nav>

          {/* Lecteur séquentiel */}
          <section aria-live="polite" className="flex min-w-0 flex-col gap-4">
            {finished && (
              <Card>
                <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
                  <PartyPopper className="size-8 text-accent" aria-hidden="true" />
                  <h2 className="font-display text-xl font-semibold text-foreground">
                    {t('finishedTitle')}
                  </h2>
                  <p className="max-w-md text-sm text-muted">
                    {t('finishedDesc')}
                  </p>
                </CardContent>
              </Card>
            )}

            {active && (
              <LessonStage
                key={active.id}
                lesson={active}
                position={activeIndex + 1}
                total={total}
                done={completed.has(active.id)}
                onMarkDone={() => markDone(active.id)}
              />
            )}

            {/* Navigation Précédent / Suivant */}
            <div className="flex items-center justify-between gap-3">
              <Button
                variant="secondary"
                size="sm"
                disabled={prevIndex === null}
                onClick={() => prevIndex !== null && goTo(prevIndex)}
              >
                <ChevronLeft aria-hidden="true" className="rtl:rotate-180" />
                {t('prev')}
              </Button>
              <span className="text-2xs tabular-nums text-muted">
                {activeIndex + 1} / {total}
              </span>
              <Button
                size="sm"
                disabled={nextIndex === null}
                onClick={() => {
                  if (active) markDone(active.id);
                  if (nextIndex !== null) goTo(nextIndex);
                }}
              >
                {t('next')}
                <ChevronRight aria-hidden="true" className="rtl:rotate-180" />
              </Button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

/** Rendu d'une leçon selon son type, avec en-tête et action « marquer vue ». */
function LessonStage({
  lesson,
  position,
  total,
  done,
  onMarkDone,
}: {
  lesson: PreviewLesson;
  position: number;
  total: number;
  done: boolean;
  onMarkDone: () => void;
}) {
  const t = useTranslations('course.preview');
  const Icon = TYPE_ICON[lesson.type] ?? FileText;
  const typeLabelKey = TYPE_LABEL_KEY[lesson.type];
  return (
    <Card>
      <CardContent className="flex flex-col gap-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-muted">
              <Icon className="size-3.5" aria-hidden="true" />
              {typeLabelKey ? t(typeLabelKey) : lesson.type}
              <span className="text-muted"> · {t('lessonPosition', { position, total })}</span>
            </p>
            <h2 className="mt-1 font-display text-xl font-semibold text-foreground">{lesson.title}</h2>
          </div>
          {lesson.type !== 'quiz' && (
            <Button variant={done ? 'secondary' : 'primary'} size="sm" onClick={onMarkDone}>
              <CheckCircle2 aria-hidden="true" />
              {done ? t('viewed') : t('markViewed')}
            </Button>
          )}
          {lesson.type === 'quiz' && done && (
            <Badge variant="published">
              <CheckCircle2 className="size-3.5" aria-hidden="true" /> {t('quizDone')}
            </Badge>
          )}
        </div>

        {/* Vidéo */}
        {lesson.type === 'video' &&
          (lesson.videoUrl ? (
            <video
              controls
              preload="metadata"
              className="aspect-video w-full rounded-md border border-border bg-black"
              crossOrigin="anonymous"
            >
              <source src={lesson.videoUrl} type="video/mp4" />
              {lesson.captionsUrl && (
                <track kind="captions" src={lesson.captionsUrl} default label={t('captions')} />
              )}
            </video>
          ) : (
            <div className="flex aspect-video w-full items-center justify-center rounded-md border border-dashed border-border bg-surface-subtle">
              <p className="text-sm text-muted">{t('videoUnavailable')}</p>
            </div>
          ))}

        {/* Transcription texte (P137, accessibilité) : à côté des sous-titres, sans timestamps. */}
        {lesson.type === 'video' && lesson.transcriptUrl && (
          <a
            href={lesson.transcriptUrl}
            download
            className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-muted underline underline-offset-2 hover:text-foreground"
          >
            <Download className="size-3.5" aria-hidden="true" />
            {t('downloadTranscript')}
          </a>
        )}

        {/* Article */}
        {lesson.type === 'article' &&
          (lesson.articleMd ? (
            <ArticleView markdown={lesson.articleMd} />
          ) : (
            <p className="text-sm text-muted">{t('articleUnavailable')}</p>
          ))}

        {/* Quiz interactif — solutions révélées APRÈS soumission */}
        {lesson.type === 'quiz' &&
          (lesson.quiz.length > 0 ? (
            <QuizRunner questions={lesson.quiz} onSubmitted={onMarkDone} />
          ) : (
            <p className="text-sm text-muted">{t('quizNoQuestions')}</p>
          ))}

        {/* TP : pas de player dédié */}
        {lesson.type === 'tp' && (
          <div className="rounded-md border border-border bg-surface-subtle p-4">
            <p className="text-sm text-muted">
              {t('tpNote')}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
