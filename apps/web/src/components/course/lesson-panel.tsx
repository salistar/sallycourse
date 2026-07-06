'use client';

import * as React from 'react';
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
import { QuizPreview } from './quiz-preview';
import { ScreenshotGallery } from './screenshot-gallery';
import { RegenerateButton } from './regenerate-button';
import { LESSON_STATUS_BADGE } from './lesson-tree';
import { ArticleEditor, QuizEditor, VideoScriptEditor } from './edit';
import type { LessonType, LessonView, Locale } from './types';

/**
 * Panneau de droite — contenu de la leçon sélectionnée : player vidéo
 * (URL présignée + piste VTT), article Markdown, galerie de captures et
 * quiz interactif, répartis en onglets selon les assets disponibles.
 */

const TYPE_LABELS: Record<LessonType, string> = {
  video: 'Leçon vidéo',
  article: 'Article',
  tp: 'Travaux pratiques',
  quiz: 'Quiz',
};

const LOCALE_LABELS: Record<Locale, string> = {
  fr: 'Français',
  en: 'English',
  ar: 'العربية',
};

type PanelTab = 'video' | 'article' | 'screenshots' | 'quiz';

export interface LessonPanelProps {
  lesson: LessonView | null;
  /** Locale du cours — langue de la piste de sous-titres. */
  locale: Locale;
  className?: string;
}

/** Contenu affiché quand la leçon n'a encore AUCUN asset exploitable. */
function NoContentState({ lesson }: { lesson: LessonView }) {
  if (lesson.status === 'generating') {
    return (
      <div className="flex flex-col gap-4 py-6">
        <Progress label="Contenu en cours de génération…" showLabel />
        <p className="text-sm text-muted">
          Les assets (vidéo, article, captures, quiz) apparaîtront ici dès que le worker aura
          terminé cette leçon.
        </p>
      </div>
    );
  }
  if (lesson.status === 'failed') {
    return (
      <EmptyState
        title="La génération a échoué"
        description="Un incident a interrompu la production de cette leçon. Relancez-la avec « Régénérer la leçon »."
      />
    );
  }
  return (
    <EmptyState
      title="Pas encore de contenu"
      description={
        lesson.status === 'pending'
          ? 'Cette leçon attend son tour dans le pipeline de génération.'
          : 'Aucun asset n’a été produit pour cette leçon.'
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

export function LessonPanel({ lesson, locale, className }: LessonPanelProps) {
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
            title="Sélectionnez une leçon"
            description="Choisissez une leçon dans le plan du cours pour prévisualiser son contenu."
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
  const tabs: { id: PanelTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [];
  if (assets.videoUrl) tabs.push({ id: 'video', label: 'Vidéo', icon: MonitorPlay });
  if (assets.articleMd) tabs.push({ id: 'article', label: 'Article', icon: FileText });
  if (assets.screenshots.length > 0) tabs.push({ id: 'screenshots', label: `Captures (${assets.screenshots.length})`, icon: Images });
  if (hasQuiz) tabs.push({ id: 'quiz', label: 'Quiz', icon: HelpCircle });

  const TypeIcon =
    lesson.type === 'video' ? Video : lesson.type === 'article' ? FileText : lesson.type === 'tp' ? FlaskConical : HelpCircle;

  return (
    <Card wrapperClassName={className}>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-muted">
              <TypeIcon className="size-3.5 text-primary" aria-hidden="true" />
              {TYPE_LABELS[lesson.type]}
              {lesson.durationMin !== undefined && (
                <span className="ms-2 inline-flex items-center gap-1 normal-case tracking-normal">
                  <Clock3 className="size-3.5" aria-hidden="true" />
                  ~{lesson.durationMin} min
                </span>
              )}
            </p>
            <h2 className="mt-1 font-display text-xl font-semibold text-foreground">{lesson.title}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Badge variant={badge.variant}>{badge.label}</Badge>
            <RegenerateButton
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
                    lessonId={lesson.id}
                    initialSlides={lesson.scriptSlides!.map((slide) => ({ ...slide }))}
                    onExit={stopEditing}
                  />
                ) : (
                  <>
                    {canEditScript && (
                      <EditToggle label="Éditer le script" onEdit={() => setEditing('video')} />
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
                        Votre navigateur ne prend pas en charge la lecture vidéo.
                      </video>
                    </div>
                    {assets.vttUrl && (
                      <p className="mt-2 text-2xs text-muted">Sous-titres ({LOCALE_LABELS[locale]}) disponibles.</p>
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
                    <EditToggle label="Éditer l’article" onEdit={() => setEditing('article')} />
                    <ArticleView markdown={assets.articleMd} />
                  </>
                )}
              </TabsContent>
            )}

            {assets.screenshots.length > 0 && (
              <TabsContent value="screenshots">
                <ScreenshotGallery screenshots={assets.screenshots} lessonTitle={lesson.title} />
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
                    <EditToggle label="Éditer le quiz" onEdit={() => setEditing('quiz')} />
                    <QuizPreview questions={lesson.quiz ?? []} />
                  </>
                )}
              </TabsContent>
            )}
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
