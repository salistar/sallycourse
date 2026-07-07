'use client';

import * as React from 'react';
import {
  Award,
  CheckCircle2,
  Circle,
  FileText,
  FlaskConical,
  HelpCircle,
  Lock,
  Video,
} from 'lucide-react';
import { Badge, Button, Card, CardContent, Progress, useToast } from '@/components/ui';
import { ArticleView } from '@/components/course/article-view';
import { QuizPreview } from '@/components/course/quiz-preview';
import { cn } from '@/lib/cn';
import type { LearnCourseView, LearnLessonView } from './types';

/**
 * Expérience apprenant d'un cours du LMS interne : plan de cours à gauche
 * (sections/leçons + coche de progression), lecteur central (vidéo / article /
 * quiz) et barre de progression. Gère l'inscription, le marquage de leçon
 * terminée et l'accès au certificat une fois le cours complété.
 */

const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  video: Video,
  article: FileText,
  tp: FlaskConical,
  quiz: HelpCircle,
};

export interface LearnCourseExperienceProps {
  course: LearnCourseView;
  isAuthenticated: boolean;
  enrolled: boolean;
  completedLessons: string[];
  completedAt: string | null;
}

export function LearnCourseExperience({
  course,
  isAuthenticated,
  enrolled: initialEnrolled,
  completedLessons: initialCompleted,
  completedAt: initialCompletedAt,
}: LearnCourseExperienceProps) {
  const { toast } = useToast();
  const [enrolled, setEnrolled] = React.useState(initialEnrolled);
  const [completed, setCompleted] = React.useState<Set<string>>(new Set(initialCompleted));
  const [completedAt, setCompletedAt] = React.useState<string | null>(initialCompletedAt);
  const [activeId, setActiveId] = React.useState<string>(course.lessons[0]?.id ?? '');
  const [busy, setBusy] = React.useState(false);

  const total = course.lessons.length;
  const doneCount = completed.size;
  const percent = total > 0 ? Math.round((doneCount / total) * 100) : 0;
  const active = course.lessons.find((l) => l.id === activeId) ?? course.lessons[0];

  // Leçons groupées par section (respecte l'ordre serveur).
  const lessonsBySection = React.useMemo(() => {
    const map = new Map<string, LearnLessonView[]>();
    for (const l of course.lessons) {
      const arr = map.get(l.sectionId) ?? [];
      arr.push(l);
      map.set(l.sectionId, arr);
    }
    return map;
  }, [course.lessons]);

  const priceLabel =
    course.priceCents > 0
      ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: course.currency }).format(
          course.priceCents / 100,
        )
      : 'Gratuit';

  async function handleEnroll() {
    if (!isAuthenticated) {
      window.location.href = `/login?callbackUrl=/learn/${course.id}`;
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/learn/${course.id}/enroll`, { method: 'POST' });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast({ title: 'Inscription impossible', description: data.error, variant: 'danger' });
        return;
      }
      setEnrolled(true);
      toast({ title: 'Inscription confirmée', description: 'Bon apprentissage !', variant: 'success' });
    } finally {
      setBusy(false);
    }
  }

  async function toggleComplete(lesson: LearnLessonView) {
    if (!enrolled) return;
    const willComplete = !completed.has(lesson.id);
    // Optimiste : on met à jour localement puis on synchronise.
    const nextSet = new Set(completed);
    if (willComplete) nextSet.add(lesson.id);
    else nextSet.delete(lesson.id);
    setCompleted(nextSet);
    try {
      const res = await fetch(`/api/learn/${course.id}/progress`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lessonId: lesson.id, completed: willComplete }),
      });
      if (!res.ok) throw new Error('progress');
      const data = (await res.json()) as { completed: boolean; completedAt: string | null };
      setCompletedAt(data.completedAt);
      if (data.completed && willComplete) {
        toast({
          title: 'Cours terminé !',
          description: 'Votre certificat est disponible.',
          variant: 'success',
        });
      }
    } catch {
      // Rollback en cas d'échec réseau.
      setCompleted(completed);
      toast({ title: 'Progression non enregistrée', variant: 'danger' });
    }
  }

  const isCourseDone = Boolean(completedAt) && doneCount >= total && total > 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-3xl font-semibold text-foreground">{course.title}</h1>
          <Badge variant={course.priceCents > 0 ? 'ready' : 'published'}>{priceLabel}</Badge>
        </div>
        {course.summary && <p className="max-w-2xl text-muted">{course.summary}</p>}
      </header>

      {/* Bandeau inscription / progression */}
      {!enrolled ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Lock className="size-5 text-muted" aria-hidden="true" />
              <p className="text-sm text-muted">
                Inscrivez-vous pour suivre votre progression et obtenir un certificat.
              </p>
            </div>
            <Button onClick={handleEnroll} disabled={busy}>
              {isAuthenticated ? "S'inscrire au cours" : 'Se connecter pour s’inscrire'}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col gap-3 p-5">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm font-medium text-foreground">
                Progression : {doneCount} / {total} leçon(s)
              </p>
              {isCourseDone && (
                <a
                  href={`/api/learn/${course.id}/certificate`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 text-sm font-semibold text-accent hover:underline"
                >
                  <Award className="size-4" aria-hidden="true" />
                  Voir mon certificat
                </a>
              )}
            </div>
            <Progress value={percent} label="Progression du cours" />
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_1fr]">
        {/* Plan de cours */}
        <nav aria-label="Plan du cours" className="flex flex-col gap-4">
          {course.sections.map((section) => {
            const sectionLessons = lessonsBySection.get(section.id) ?? [];
            if (sectionLessons.length === 0) return null;
            return (
              <div key={section.id} className="flex flex-col gap-1.5">
                <p className="px-2 text-2xs font-semibold uppercase tracking-wide text-muted">
                  {section.title}
                </p>
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {sectionLessons.map((lesson) => {
                    const Icon = TYPE_ICON[lesson.type] ?? FileText;
                    const isActive = lesson.id === activeId;
                    const isDone = completed.has(lesson.id);
                    return (
                      <li key={lesson.id}>
                        <button
                          type="button"
                          onClick={() => setActiveId(lesson.id)}
                          className={cn(
                            'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-start text-sm',
                            'transition-colors duration-fast',
                            isActive
                              ? 'bg-primary-soft/60 text-foreground'
                              : 'text-muted hover:bg-surface-subtle hover:text-foreground',
                          )}
                          aria-current={isActive ? 'true' : undefined}
                        >
                          <span className="shrink-0 text-muted">
                            {isDone ? (
                              <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
                            ) : (
                              <Circle className="size-4" aria-hidden="true" />
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

        {/* Lecteur */}
        <section aria-live="polite" className="min-w-0">
          {active ? (
            <LessonPlayer
              lesson={active}
              enrolled={enrolled}
              done={completed.has(active.id)}
              onToggleComplete={() => toggleComplete(active)}
            />
          ) : (
            <p className="text-sm text-muted">Ce cours ne contient encore aucune leçon.</p>
          )}
        </section>
      </div>
    </div>
  );
}

/** Rendu d'une leçon selon son type : vidéo, article ou quiz interactif. */
function LessonPlayer({
  lesson,
  enrolled,
  done,
  onToggleComplete,
}: {
  lesson: LearnLessonView;
  enrolled: boolean;
  done: boolean;
  onToggleComplete: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold text-foreground">{lesson.title}</h2>
          {enrolled && (
            <Button
              variant={done ? 'secondary' : 'primary'}
              size="sm"
              onClick={onToggleComplete}
            >
              <CheckCircle2 aria-hidden="true" />
              {done ? 'Terminée' : 'Marquer comme terminée'}
            </Button>
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
                <track kind="captions" src={lesson.captionsUrl} default label="Sous-titres" />
              )}
            </video>
          ) : (
            <p className="text-sm text-muted">La vidéo de cette leçon n’est pas encore disponible.</p>
          ))}

        {/* Article */}
        {lesson.type === 'article' &&
          (lesson.articleMd ? (
            <ArticleView markdown={lesson.articleMd} />
          ) : (
            <p className="text-sm text-muted">L’article de cette leçon n’est pas encore disponible.</p>
          ))}

        {/* Quiz interactif */}
        {lesson.type === 'quiz' &&
          (lesson.quiz.length > 0 ? (
            <QuizPreview questions={lesson.quiz} />
          ) : (
            <p className="text-sm text-muted">Ce quiz ne contient pas encore de questions.</p>
          ))}

        {/* TP : pas de player dédié dans le LMS — renvoi vers le pack. */}
        {lesson.type === 'tp' && (
          <p className="text-sm text-muted">
            Les travaux pratiques se réalisent dans l’environnement fourni avec le cours.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
