'use client';

import * as React from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import {
  Award,
  CheckCircle2,
  Circle,
  Download,
  ExternalLink,
  FileText,
  FlaskConical,
  HelpCircle,
  Lock,
  Video,
} from 'lucide-react';
import { Badge, Button, Card, CardContent, Progress, useToast } from '@/components/ui';
import { ArticleView } from '@/components/course/article-view';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/error-message';
import { LearnQuizPlayer } from './learn-quiz-player';
import { CourseChatbotWidget } from './course-chatbot-widget';
import { WatermarkedVideo } from './watermarked-video';
import { GamificationHud } from './gamification-hud';
import { CourseLeaderboard } from './course-leaderboard';
import type { GamificationAwardView, LearnCourseView, LearnLessonView } from './types';

/**
 * Expérience apprenant d'un cours du LMS interne : plan de cours à gauche
 * (sections/leçons + coche de progression), lecteur central (vidéo / article /
 * quiz) et barre de progression. Gère l'inscription, le marquage de leçon
 * terminée et l'accès au certificat une fois le cours complété.
 *
 * P200 (gamification) : /track renvoie le delta d'XP à la PREMIÈRE complétion
 * d'une leçon (XP, niveau, badges, streak). `trackEvent` est donc devenu async
 * et remonte ce payload, qui alimente le HUD (barre d'XP, flamme, badges,
 * confetti) et rafraîchit le classement du cours.
 */

/** Réponse de POST /api/learn/[courseId]/track. */
interface TrackResponse {
  ok: boolean;
  gamification: GamificationAwardView | null;
}

/** Formate un prix en centimes vers une devise Intl — libellé « gratuit » si nul. */
function formatPrice(
  cents: number,
  currency: string,
  format: ReturnType<typeof useFormatter>,
  freeLabel: string,
): string {
  return cents > 0
    ? format.number(cents / 100, { style: 'currency', currency })
    : freeLabel;
}

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
  /** Code promo actif résolu côté serveur (P139) — absent si aucun/invalide. */
  promoCode?: string;
  /** Prix déjà remisé (centimes) correspondant à promoCode, si applicable. */
  promoPriceCents?: number;
}

export function LearnCourseExperience({
  course,
  isAuthenticated,
  enrolled: initialEnrolled,
  completedLessons: initialCompleted,
  completedAt: initialCompletedAt,
  promoCode,
  promoPriceCents,
}: LearnCourseExperienceProps) {
  const { toast } = useToast();
  const t = useTranslations('learn.experience');
  const tApiError = useTranslations('apiErrors');
  const format = useFormatter();
  const [enrolled, setEnrolled] = React.useState(initialEnrolled);
  const [completed, setCompleted] = React.useState<Set<string>>(new Set(initialCompleted));
  const [completedAt, setCompletedAt] = React.useState<string | null>(initialCompletedAt);
  const [activeId, setActiveId] = React.useState<string>(course.lessons[0]?.id ?? '');
  const [busy, setBusy] = React.useState(false);
  // Gamification (P200) : dernier gain d'XP renvoyé par /track (HUD + confetti)
  // et jeton de rafraîchissement du classement (incrémenté à chaque gain).
  const [award, setAward] = React.useState<GamificationAwardView | null>(null);
  const [xpVersion, setXpVersion] = React.useState(0);

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

  const priceLabel = formatPrice(course.priceCents, course.currency, format, t('free'));
  const hasPromo = typeof promoPriceCents === 'number' && promoPriceCents < course.priceCents;
  const promoPriceLabel = hasPromo
    ? formatPrice(promoPriceCents!, course.currency, format, t('free'))
    : undefined;

  // Tracking granulaire (P144) : timestamp d'entrée sur la leçon active, sert
  // à approximer le temps passé transmis à /track lors du "completed".
  const lessonStartRef = React.useRef<number>(Date.now());

  /**
   * Envoi best-effort d'un événement au tracker — n'affecte jamais la lecture
   * en cas d'échec. Retourne le payload de la route (P200 : le delta d'XP à la
   * première complétion, `null` sinon).
   */
  async function trackEvent(
    lessonId: string,
    event: 'started' | 'completed' | 'heartbeat',
    extra?: { deltaSeconds?: number; quizScore?: number },
  ): Promise<TrackResponse | null> {
    if (!enrolled) return null;
    try {
      const res = await fetch(`/api/learn/${course.id}/track`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lessonId, event, ...extra }),
      });
      if (!res.ok) return null;
      return (await res.json()) as TrackResponse;
    } catch {
      // best-effort : le player continue sans blocage
      return null;
    }
  }

  /** Applique un gain d'XP remonté par le player (HUD + rafraîchissement du classement). */
  const applyAward = React.useCallback((next: GamificationAwardView | null) => {
    if (!next) return;
    setAward(next);
    setXpVersion((v) => v + 1);
  }, []);

  // Marque la leçon active comme "commencée" et réinitialise le chrono
  // d'approximation du temps passé à chaque changement de leçon.
  React.useEffect(() => {
    if (!active || !enrolled) return;
    lessonStartRef.current = Date.now();
    void trackEvent(active.id, 'started');
  }, [active?.id, enrolled]);

  async function handleEnroll() {
    if (!isAuthenticated) {
      window.location.href = `/login?callbackUrl=/learn/${course.id}`;
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/learn/${course.id}/enroll`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(promoCode ? { couponCode: promoCode } : {}),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        // 402 = cours payant, paiement en ligne pas encore branché. On ne montre
        // JAMAIS le motif technique interne (« CMI / Phase 4 ») à l'apprenant.
        if (res.status === 402) {
          toast({
            title: t('paymentSoonTitle'),
            description: t('paymentSoonDescription'),
          });
          return;
        }
        toast({ title: t('enrollFailedTitle'), description: errorMessage(data, tApiError), variant: 'danger' });
        return;
      }
      setEnrolled(true);
      toast({
        title: t('enrollConfirmedTitle'),
        description: t('enrollConfirmedDescription'),
        variant: 'success',
      });
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
      if (willComplete) {
        // Temps passé approximatif depuis l'affichage de la leçon (P144).
        // /progress a déjà posé Enrollment.completedAt le cas échéant : le
        // badge « cours bouclé » est donc évaluable dès cet appel (P200).
        const deltaSeconds = Math.round((Date.now() - lessonStartRef.current) / 1000);
        const tracked = await trackEvent(lesson.id, 'completed', { deltaSeconds });
        applyAward(tracked?.gamification ?? null);
      }
      if (data.completed && willComplete) {
        toast({
          title: t('courseCompletedTitle'),
          description: t('courseCompletedDescription'),
          variant: 'success',
        });
      }
    } catch {
      // Rollback en cas d'échec réseau.
      setCompleted(completed);
      toast({ title: t('progressNotSavedTitle'), variant: 'danger' });
    }
  }

  const isCourseDone = Boolean(completedAt) && doneCount >= total && total > 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-3xl font-semibold text-foreground">{course.title}</h1>
          {hasPromo ? (
            <>
              <Badge variant="published">{promoPriceLabel}</Badge>
              <span className="text-sm text-muted line-through">{priceLabel}</span>
              <Badge variant="ready">{t('promoBadge', { code: promoCode })}</Badge>
            </>
          ) : (
            <Badge variant={course.priceCents > 0 ? 'ready' : 'published'}>{priceLabel}</Badge>
          )}
        </div>
        {course.summary && <p className="max-w-2xl text-muted">{course.summary}</p>}
      </header>

      {/* Bandeau inscription / progression */}
      {!enrolled ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Lock className="size-5 text-muted" aria-hidden="true" />
              <p className="text-sm text-muted">{t('enrollPrompt')}</p>
            </div>
            <Button onClick={handleEnroll} disabled={busy}>
              {isAuthenticated ? t('enrollCta') : t('loginToEnrollCta')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col gap-3 p-5">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm font-medium text-foreground">
                {t('progressCount', { done: doneCount, total })}
              </p>
              {isCourseDone && (
                <a
                  href={`/api/learn/${course.id}/certificate`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 text-sm font-semibold text-accent hover:underline"
                >
                  <Award className="size-4" aria-hidden="true" />
                  {t('viewCertificate')}
                </a>
              )}
            </div>
            <Progress value={percent} label={t('courseProgressLabel')} />
          </CardContent>
        </Card>
      )}

      {/* Gamification (P200) — HUD (niveau, XP, série, badges) + classement du cours. */}
      {enrolled && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <GamificationHud award={award} />
          <CourseLeaderboard courseId={course.id} refreshToken={xpVersion} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_1fr]">
        {/* Plan de cours */}
        <nav aria-label={t('coursePlanAria')} className="flex flex-col gap-4">
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
              courseId={course.id}
              lesson={active}
              enrolled={enrolled}
              done={completed.has(active.id)}
              onToggleComplete={() => toggleComplete(active)}
              onXpAwarded={applyAward}
            />
          ) : (
            <p className="text-sm text-muted">{t('noLessons')}</p>
          )}
        </section>
      </div>

      {/* Assistant de cours (P146) — accessible uniquement à l'apprenant inscrit. */}
      {enrolled && (
        <CourseChatbotWidget
          courseId={course.id}
          lessonTitleById={Object.fromEntries(course.lessons.map((l) => [l.id, l.title]))}
        />
      )}
    </div>
  );
}

/** Rendu d'une leçon selon son type : vidéo, article ou quiz interactif. */
function LessonPlayer({
  courseId,
  lesson,
  enrolled,
  done,
  onToggleComplete,
  onXpAwarded,
}: {
  courseId: string;
  lesson: LearnLessonView;
  enrolled: boolean;
  done: boolean;
  onToggleComplete: () => void;
  /** Remonte le delta d'XP renvoyé par /track à la soumission d'un quiz (P200). */
  onXpAwarded: (award: GamificationAwardView | null) => void;
}) {
  const t = useTranslations('learn.experience');
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
              {done ? t('lessonDone') : t('markComplete')}
            </Button>
          )}
        </div>

        {/* Vidéo — anti-piratage (P206) : la lecture passe toujours par le lecteur
            filigrané, qui demande à …/watch une URL signée courte vers la copie
            filigranée de l'étudiant (rendu paresseux, cache par leçon×étudiant).
            /watch exige l'inscription : aucune URL vidéo brute n'est exposée dans
            la page. Un visiteur NON inscrit ne reçoit donc pas la vidéo — il doit
            s'inscrire pour y accéder. */}
        {lesson.type === 'video' &&
          (enrolled ? (
            <WatermarkedVideo
              courseId={courseId}
              lessonId={lesson.id}
              captionsUrl={lesson.captionsUrl}
            />
          ) : (
            <p className="text-sm text-muted">{t('enrollToWatch')}</p>
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

        {/* Article — réservé aux inscrits (le contenu n'est pas sérialisé sinon). */}
        {lesson.type === 'article' &&
          (!enrolled ? (
            <p className="text-sm text-muted">{t('enrollToRead')}</p>
          ) : lesson.articleMd ? (
            <ArticleView markdown={lesson.articleMd} />
          ) : (
            <p className="text-sm text-muted">{t('articleUnavailable')}</p>
          ))}

        {/* Quiz interactif — réservé aux inscrits (les réponses ne sont pas
            sérialisées pour un non-inscrit) ; soumission détaillée + « Plus d'exercices » (P145) */}
        {lesson.type === 'quiz' &&
          (!enrolled ? (
            <p className="text-sm text-muted">{t('enrollToQuiz')}</p>
          ) : lesson.quiz.length > 0 ? (
            <LearnQuizPlayer
              courseId={courseId}
              lessonId={lesson.id}
              lessonTitle={lesson.title}
              questions={lesson.quiz}
              onXpAwarded={onXpAwarded}
            />
          ) : (
            <p className="text-sm text-muted">{t('quizNoQuestions')}</p>
          ))}

        {/* TP : pas de player dédié dans le LMS — renvoi vers le pack. */}
        {lesson.type === 'tp' && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">{t('tpInstructions')}</p>
            {lesson.sandboxLinks && <SandboxLinksPanel links={lesson.sandboxLinks} />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Boutons d'ouverture du TP dans un IDE en ligne (P84) : deux projets
 * distincts (code de départ / solution), chacun ouvrable dans StackBlitz ou
 * CodeSandbox. N'apparaît que si le langage du TP a été détecté côté worker.
 */
function SandboxLinksPanel({ links }: { links: NonNullable<LearnLessonView['sandboxLinks']> }) {
  const t = useTranslations('learn.experience');
  const rows: Array<{ label: string; project: { stackblitzUrl: string; codesandboxUrl: string } }> = [
    { label: t('sandboxStarter'), project: links.starter },
    { label: t('sandboxSolution'), project: links.solution },
  ];
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-surface-subtle p-4">
      <p className="text-sm font-medium text-foreground">
        {t('sandboxPanelTitle', { language: links.language })}
      </p>
      {rows.map((row) => (
        <div key={row.label} className="flex flex-wrap items-center gap-2">
          <span className="min-w-24 text-xs font-semibold uppercase tracking-wide text-muted">
            {row.label}
          </span>
          <a href={row.project.stackblitzUrl} target="_blank" rel="noreferrer">
            <Button variant="secondary" size="sm">
              <ExternalLink aria-hidden="true" />
              {t('openInStackblitz')}
            </Button>
          </a>
          <a href={row.project.codesandboxUrl} target="_blank" rel="noreferrer">
            <Button variant="secondary" size="sm">
              <ExternalLink aria-hidden="true" />
              {t('openInCodesandbox')}
            </Button>
          </a>
        </div>
      ))}
    </div>
  );
}
