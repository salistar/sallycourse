'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Clock3, FileText, FlaskConical, HelpCircle, Images, MonitorPlay, Pencil, Video } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  Progress,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui';
import { ArticleView } from './article-view';
import { TpView } from './tp-view';
import { QuizPreview } from './quiz-preview';
import { ScreenshotGallery } from './screenshot-gallery';
import { RegenerateButton } from './regenerate-button';
import { EditWithAiButton } from './edit-with-ai-button';
import { DeleteLessonButton } from './delete-lesson-button';
import { RecaptureScreenshotsButton } from './recapture-screenshots-button';
import { ApprovePreviewButton } from './approve-preview-button';
import { LessonComments } from './lesson-comments';
import { ScreencastPanel } from './screencast-panel';
import { AudioRepairPanel } from './audio-repair-panel';
import { LESSON_STATUS_BADGE } from './lesson-tree';
import { ArticleEditor, QuizEditor, VideoScriptEditor, TpEditor } from './edit';
import type { LessonType, LessonView, Locale } from './types';

/**
 * Panneau de droite — contenu de la leçon sélectionnée : player vidéo
 * (URL présignée + piste VTT), article Markdown, galerie de captures et
 * quiz interactif, répartis en onglets selon les assets disponibles.
 */

const TYPE_LABELS: Record<LessonType, string> = {
  video: 'typeVideo',
  article: 'typeArticle',
  tp: 'typeTp',
  quiz: 'typeQuiz',
};

const LOCALE_LABELS: Record<Locale, string> = {
  fr: 'Français',
  en: 'English',
  ar: 'العربية',
};

type PanelTab = 'video' | 'article' | 'tp' | 'screenshots' | 'quiz';

export interface LessonPanelProps {
  lesson: LessonView | null;
  /** Locale du cours — langue de la piste de sous-titres. */
  locale: Locale;
  /** Id du cours — nécessaire à l'éditeur de capture d'écran (Feature B). */
  courseId: string;
  /** Affiche les commentaires d'équipe (Prompt 138) — uniquement en contexte Workspace. */
  showComments?: boolean;
  className?: string;
}

/** Contenu affiché quand la leçon n'a encore AUCUN asset exploitable. */
function NoContentState({ lesson }: { lesson: LessonView }) {
  const t = useTranslations('course.lessonPanel');
  if (lesson.status === 'generating') {
    return (
      <div className="flex flex-col gap-4 py-6">
        <Progress label={t('generatingLabel')} showLabel />
        <p className="text-sm text-muted">
          {t('generatingHint')}
        </p>
      </div>
    );
  }
  if (lesson.status === 'failed') {
    return (
      <EmptyState
        title={t('failedTitle')}
        description={t('failedDescription')}
      />
    );
  }
  return (
    <EmptyState
      title={t('emptyTitle')}
      description={
        lesson.status === 'pending'
          ? t('pendingDescription')
          : t('noAssetDescription')
      }
    />
  );
}

/** Barre d'action « Éditer » affichée en tête d'un onglet éditable. */
function EditToggle({ label, onEdit }: { label: string; onEdit: () => void }) {
  return (
    <div className="mb-4 flex justify-end">
      <Button variant="secondary" size="sm" onClick={onEdit}>
        <Pencil aria-hidden="true" />
        {label}
      </Button>
    </div>
  );
}

export function LessonPanel({ lesson, locale, courseId, showComments, className }: LessonPanelProps) {
  const t = useTranslations('course.lessonPanel');
  // Onglet actuellement en mode édition (null = prévisualisation).
  const [editing, setEditing] = React.useState<PanelTab | null>(null);
  const stopEditing = React.useCallback(() => setEditing(null), []);

  // Changer de leçon ferme tout éditeur ouvert.
  const lessonId = lesson?.id;
  React.useEffect(() => {
    setEditing(null);
  }, [lessonId]);

  if (!lesson) {
    return (
      <Card wrapperClassName={className}>
        <CardContent className="pt-6">
          <EmptyState
            title={t('selectLessonTitle')}
            description={t('selectLessonDescription')}
          />
        </CardContent>
      </Card>
    );
  }

  const badge = LESSON_STATUS_BADGE[lesson.status];
  const { assets } = lesson;
  const hasQuiz = Boolean(lesson.quiz && lesson.quiz.length > 0);
  // Édition du script possible si des slides ont été produites (leçon vidéo).
  const canEditScript = Boolean(lesson.scriptSlides && lesson.scriptSlides.length > 0);

  // Onglets disponibles selon les assets réellement produits.
  const populatedScreenshots = assets.screenshots.filter(Boolean);
  // Lot 5 (plan 2026-07-20) : l'onglet captures reste visible pour un TP même
  // sans AUCUNE capture automatique réussie — l'auteur doit pouvoir uploader
  // manuellement depuis zéro, pas seulement remplacer une capture existante.
  const showScreenshotsTab = populatedScreenshots.length > 0 || (lesson.type === 'tp' && Boolean(lesson.tpContent));
  const tabs: { id: PanelTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [];
  if (assets.videoUrl) tabs.push({ id: 'video', label: t('tabVideo'), icon: MonitorPlay });
  if (assets.articleMd) tabs.push({ id: 'article', label: t('tabArticle'), icon: FileText });
  if (lesson.type === 'tp' && lesson.tpContent) tabs.push({ id: 'tp', label: t('tabTp'), icon: FlaskConical });
  if (showScreenshotsTab) {
    tabs.push({ id: 'screenshots', label: t('tabScreenshots', { count: populatedScreenshots.length }), icon: Images });
  }
  if (hasQuiz) tabs.push({ id: 'quiz', label: t('tabQuiz'), icon: HelpCircle });

  const TypeIcon =
    lesson.type === 'video' ? Video : lesson.type === 'article' ? FileText : lesson.type === 'tp' ? FlaskConical : HelpCircle;

  return (
    <Card wrapperClassName={className}>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-muted">
              <TypeIcon className="size-3.5 text-primary" aria-hidden="true" />
              {t(TYPE_LABELS[lesson.type])}
              {lesson.durationMin !== undefined && (
                <span className="ms-2 inline-flex items-center gap-1 normal-case tracking-normal">
                  <Clock3 className="size-3.5" aria-hidden="true" />
                  {t('durationMin', { min: lesson.durationMin })}
                </span>
              )}
            </p>
            <h2 className="mt-1 font-display text-xl font-semibold text-foreground">{lesson.title}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Badge variant={badge.variant}>{badge.label}</Badge>
            {lesson.type === 'video' && (
              <ApprovePreviewButton lessonId={lesson.id} videoQualityStatus={lesson.videoQualityStatus} />
            )}
            <EditWithAiButton
              lessonId={lesson.id}
              lessonTitle={lesson.title}
              disabled={lesson.status === 'generating'}
            />
            <RegenerateButton
              lessonId={lesson.id}
              lessonTitle={lesson.title}
              disabled={lesson.status === 'generating'}
            />
            <DeleteLessonButton
              lessonId={lesson.id}
              lessonTitle={lesson.title}
              disabled={lesson.status === 'generating'}
            />
          </div>
        </div>
        {lesson.summary && <p className="text-sm text-muted">{lesson.summary}</p>}
      </CardHeader>

      <CardContent>
        {tabs.length === 0 ? (
          <NoContentState lesson={lesson} />
        ) : (
          // key={lesson.id} : changer de leçon réinitialise onglet actif et quiz.
          <Tabs key={lesson.id} defaultValue={tabs[0]!.id}>
            <TabsList>
              {tabs.map(({ id, label, icon: Icon }) => (
                <TabsTrigger key={id} value={id} className="flex items-center gap-1.5">
                  <Icon className="size-4" aria-hidden="true" />
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>

            {assets.videoUrl && (
              <TabsContent value="video">
                {editing === 'video' && canEditScript ? (
                  <VideoScriptEditor
                    courseId={courseId}
                    lessonId={lesson.id}
                    initialSlides={lesson.scriptSlides!.map((slide) => ({ ...slide }))}
                    onExit={stopEditing}
                  />
                ) : (
                  <>
                    {canEditScript && (
                      <EditToggle label={t('editScript')} onEdit={() => setEditing('video')} />
                    )}
                    <div className="overflow-hidden rounded-md border border-border bg-neutral-950 shadow-sm">
                      {/* URL présignée générée côté serveur ; piste VTT si produite. */}
                      <video controls preload="metadata" className="aspect-video w-full" src={assets.videoUrl} crossOrigin="anonymous">
                        {assets.vttUrl && (
                          <track
                            kind="subtitles"
                            src={assets.vttUrl}
                            srcLang={locale}
                            label={LOCALE_LABELS[locale]}
                            default
                          />
                        )}
                        {t('videoUnsupported')}
                      </video>
                    </div>
                    {assets.vttUrl && (
                      <p className="mt-2 text-2xs text-muted">{t('subtitlesAvailable', { locale: LOCALE_LABELS[locale] })}</p>
                    )}
                    {assets.videoVerticalUrl && (
                      <p className="mt-2 text-2xs">
                        <a
                          href={assets.videoVerticalUrl}
                          download
                          className="font-medium text-primary underline-offset-2 hover:underline"
                        >
                          {t('downloadVertical')}
                        </a>
                      </p>
                    )}
                  </>
                )}
              </TabsContent>
            )}

            {assets.articleMd && (
              <TabsContent value="article">
                {editing === 'article' ? (
                  <ArticleEditor
                    lessonId={lesson.id}
                    initialMarkdown={assets.articleMd}
                    onExit={stopEditing}
                  />
                ) : (
                  <>
                    <EditToggle label={t('editArticle')} onEdit={() => setEditing('article')} />
                    <ArticleView markdown={assets.articleMd} />
                  </>
                )}
              </TabsContent>
            )}

            {lesson.type === 'tp' && lesson.tpContent && (
              <TabsContent value="tp">
                {editing === 'tp' ? (
                  <TpEditor
                    lessonId={lesson.id}
                    initialObjective={lesson.tpContent.objective}
                    initialEnvironment={lesson.tpContent.environment}
                    initialSteps={lesson.tpContent.steps.map((step) => ({
                      instruction: step.instruction,
                      command: step.command ?? '',
                      expectedResult: step.expectedResult,
                      rest: { ...step.rest },
                    }))}
                    initialValidation={lesson.tpContent.validation}
                    initialTroubleshooting={lesson.tpContent.troubleshooting}
                    onExit={stopEditing}
                  />
                ) : (
                  <>
                    <EditToggle label={t('editTp')} onEdit={() => setEditing('tp')} />
                    <TpView tp={lesson.tpContent} />
                  </>
                )}
              </TabsContent>
            )}

            {showScreenshotsTab && (
              <TabsContent value="screenshots">
                {lesson.type === 'tp' && lesson.tpContent && (
                  <div className="mb-4 flex justify-end">
                    <RecaptureScreenshotsButton
                      lessonId={lesson.id}
                      lessonTitle={lesson.title}
                      disabled={lesson.status === 'generating'}
                    />
                  </div>
                )}
                <ScreenshotGallery
                  screenshots={assets.screenshots}
                  lessonTitle={lesson.title}
                  editable={
                    lesson.type === 'tp' && lesson.tpContent
                      ? { courseId, lessonId: lesson.id, totalSteps: lesson.tpContent.steps.length }
                      : undefined
                  }
                />
              </TabsContent>
            )}

            {hasQuiz && (
              <TabsContent value="quiz">
                {editing === 'quiz' ? (
                  <QuizEditor
                    lessonId={lesson.id}
                    initialQuestions={(lesson.quiz ?? []).map((q) => ({
                      ...q,
                      choices: [...q.choices],
                    }))}
                    onExit={stopEditing}
                  />
                ) : (
                  <>
                    <EditToggle label={t('editQuiz')} onEdit={() => setEditing('quiz')} />
                    <QuizPreview questions={lesson.quiz ?? []} />
                  </>
                )}
              </TabsContent>
            )}
          </Tabs>
        )}
        {/* Réparer l'audio (Lot 2, plan 2026-07-20) — uniquement une fois la
            vidéo réellement rendue (rien à réparer avant). */}
        {lesson.type === 'video' && assets.videoUrl && (
          <div className="mt-6">
            <AudioRepairPanel courseId={courseId} lessonId={lesson.id} lessonTitle={lesson.title} />
          </div>
        )}
        {/* Capture d'écran narrée (Feature B) — pertinente pour les démos/TP et
            les leçons vidéo : l'auteur téléverse un enregistrement d'écran,
            ajoute une narration + des légendes chronométrées. */}
        {(lesson.type === 'tp' || lesson.type === 'video') && (
          <div className="mt-6">
            <ScreencastPanel courseId={courseId} lessonId={lesson.id} />
          </div>
        )}
        {showComments && <LessonComments lessonId={lesson.id} />}
      </CardContent>
    </Card>
  );
}
