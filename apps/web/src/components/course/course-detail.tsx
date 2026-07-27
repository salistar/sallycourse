'use client';

import * as React from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import Link from 'next/link';
import { ArrowLeft, BarChart3, CalendarDays, Download, Eye, GraduationCap, Languages, Rocket } from 'lucide-react';
import { Badge, Button, EmptyState, ToastProvider, Toaster, buttonVariants, type BadgeProps } from '@/components/ui';
import { LessonTree } from './lesson-tree';
import { LessonPanel } from './lesson-panel';
import { AddLessonButton } from './add-lesson-button';
import { ThemeSwitcherPanel } from './theme-switcher-panel';
import { CoverPanel } from './cover-panel';
import { ReviewPanel } from './review-panel';
import { ProgressBanner } from './progress-banner';
import { DownloadPackButton } from './download-pack-button';
import { DownloadPortableButton } from './download-portable-button';
import { DownloadMasterArchiveButton } from './download-master-archive-button';
import { DownloadScormButton } from './download-scorm-button';
import { DeriveButton } from './derive-button';
import { IntroVideoUpload } from './intro-video-upload';
import { DeployPanel } from './deploy-panel';
import { QaReportPanel } from './qa-report-panel';
import { QualityScorePanel } from './quality-score-panel';
import { FeedbackPanel } from './feedback-panel';
import { ResourcesPanel } from './resources-panel';
import { RepurposingPanel } from './repurposing-panel';
import { MarketingKitPanel } from './marketing-kit-panel';
import { ArchivedBanner } from './archived-banner';
import { BlogPanel } from './blog-panel';
import { TranslatePanel } from './translate-panel';
import { QuickPreviewPanel } from './quick-preview-panel';
import { TeamApprovalBanner } from './team-approval-banner';
import { CancelGenerationButton } from './cancel-generation-button';
import { SellCourseButton } from './sell-course-button';
import { ShareWorkspaceButton } from './share-workspace-button';
import { ValidationContinueBanner } from './validation-continue-banner';
import type { CourseDetailView, CourseStatus, Difficulty, Locale } from './types';

/**
 * Expérience client de la page détail — en-tête (titre, statut, actions
 * cours), bandeau de progression si génération en cours, puis arborescence
 * des leçons à gauche et panneau de prévisualisation à droite.
 */

/** Statut de cours → variante Badge + clé de libellé (aligné sur la carte dashboard). */
const COURSE_STATUS_BADGE: Record<
  CourseStatus,
  { variant: NonNullable<BadgeProps['variant']>; labelKey: string }
> = {
  draft: { variant: 'draft', labelKey: 'statusDraft' },
  generating: { variant: 'generating', labelKey: 'statusGenerating' },
  'outline-review': { variant: 'draft', labelKey: 'statusOutlineReview' },
  ready: { variant: 'ready', labelKey: 'statusReady' },
  published: { variant: 'published', labelKey: 'statusPublished' },
  failed: { variant: 'failed', labelKey: 'statusFailed' },
  // Annulation (P73) — pas de variante Badge dédiée, réutilise 'failed' (arrêt).
  cancelled: { variant: 'failed', labelKey: 'statusCancelled' },
};

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: 'difficultyBeginner',
  intermediate: 'difficultyIntermediate',
  advanced: 'difficultyAdvanced',
};

const LOCALE_LABELS: Record<Locale, string> = {
  fr: 'Français',
  en: 'English',
  ar: 'العربية',
};

/** Clés de libellé des familles de providers affichées sur la fiche du cours (P160). */
const PROVIDER_MIX_FAMILY_LABELS = {
  llm: 'providerFamilyLlm',
  tts: 'providerFamilyTts',
  image: 'providerFamilyImage',
} as const;

export interface CourseDetailProps {
  course: CourseDetailView;
}

export function CourseDetail({ course }: CourseDetailProps) {
  const t = useTranslations('course.detail');
  const format = useFormatter();

  const allLessons = React.useMemo(
    () => course.sections.flatMap((section) => section.lessons),
    [course.sections],
  );

  const [selectedId, setSelectedId] = React.useState<string | null>(allLessons[0]?.id ?? null);
  const selected = allLessons.find((lesson) => lesson.id === selectedId) ?? allLessons[0] ?? null;

  const badge = COURSE_STATUS_BADGE[course.status];
  const createdAt = new Date(course.createdAt);
  const lessonCount = allLessons.length;

  const deployable = course.status === 'ready' || course.status === 'published';
  const [deployOpen, setDeployOpen] = React.useState(false);

  return (
    <ToastProvider>
      <div className="flex flex-col gap-8">
        {/* ── En-tête du cours ─────────────────────────────────── */}
        <header className="flex flex-col gap-4">
          <Link
            href="/dashboard"
            className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted transition-colors duration-fast hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            {t('backToDashboard')}
          </Link>

          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">
                  {course.title}
                </h1>
                <Badge variant={badge.variant}>{t(badge.labelKey)}</Badge>
              </div>
              <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <GraduationCap className="size-4" aria-hidden="true" />
                  {t(DIFFICULTY_LABELS[course.difficulty])}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Languages className="size-4" aria-hidden="true" />
                  {LOCALE_LABELS[course.locale]}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="size-4" aria-hidden="true" />
                  {t('createdOn', {
                    date: format.dateTime(createdAt, {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    }),
                  })}
                </span>
                {lessonCount > 0 && (
                  <span className="tabular-nums">
                    {t('sectionsAndLessons', {
                      sectionCount: course.sections.length,
                      lessonCount,
                    })}
                  </span>
                )}
              </p>
              {/* Mix de providers réellement utilisé (P160) — défaut OSS si jamais enregistré. */}
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted">
                <span>{t('generationLabel')}</span>
                {(['llm', 'tts', 'image'] as const).map((family) => {
                  const choice = course.providerMix?.[family] ?? 'oss';
                  return (
                    <span
                      key={family}
                      className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5"
                    >
                      {t(PROVIDER_MIX_FAMILY_LABELS[family])} : {choice === 'cloud' ? 'Cloud' : 'OSS'}
                    </span>
                  );
                })}
              </p>
            </div>

            {/* Actions cours — pack export actif une fois le cours abouti. */}
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {/* Annulation propre (P73) — pendant la génération uniquement. */}
              {(course.status === 'generating' || course.status === 'outline-review') && (
                <CancelGenerationButton courseId={course.id} />
              )}
              {/* Analytics du cours (dashboard + A/B + heatmap) — dès qu'il a des leçons. */}
              {lessonCount > 0 && (
                <Link
                  href={`/dashboard/courses/${course.id}/analytics`}
                  className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                >
                  <BarChart3 aria-hidden="true" />
                  {t('analytics')}
                </Link>
              )}
              {/* Aperçu « mode étudiant » (P60) — dès qu'il y a des leçons. */}
              {lessonCount > 0 ? (
                <Link
                  href={`/dashboard/courses/${course.id}/preview`}
                  className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                >
                  <Eye aria-hidden="true" />
                  {t('studentPreview')}
                </Link>
              ) : (
                <span title={t('availableWhenHasLessons')} className="inline-flex">
                  <Button variant="secondary" size="sm" disabled aria-disabled="true">
                    <Eye aria-hidden="true" />
                    {t('studentPreview')}
                  </Button>
                </span>
              )}
              {/* Déclinaison (P64) — dès que le plan est validé (cours abouti). */}
              {deployable && (
                <DeriveButton
                  courseId={course.id}
                  sourceLocale={course.locale}
                  sourceDifficulty={course.difficulty}
                />
              )}
              {/* Mise en vente marketplace (P147) — cours abouti uniquement. */}
              {(course.status === 'ready' || course.status === 'published') && (
                <SellCourseButton courseId={course.id} />
              )}
              {/* Validation d'équipe (P138) — partage si pas déjà dans un workspace. */}
              {!course.workspace && (
                <ShareWorkspaceButton courseId={course.id} courseTitle={course.title} />
              )}
              {course.status === 'ready' || course.status === 'published' ? (
                <>
                  <DownloadPackButton courseId={course.id} />
                  <DownloadPortableButton courseId={course.id} />
                  <DownloadMasterArchiveButton courseId={course.id} />
                  <DownloadScormButton courseId={course.id} />
                </>
              ) : (
                <>
                  <span title={t('availableOnceGenerated')} className="inline-flex">
                    <Button variant="secondary" size="sm" disabled aria-disabled="true">
                      <Download aria-hidden="true" />
                      {t('downloadPack')}
                    </Button>
                  </span>
                  <span title={t('availableOnceGenerated')} className="inline-flex">
                    <Button variant="secondary" size="sm" disabled aria-disabled="true">
                      <Download aria-hidden="true" />
                      {t('exportPortable')}
                    </Button>
                  </span>
                </>
              )}
              {deployable ? (
                <Button
                  variant="gold"
                  size="sm"
                  aria-expanded={deployOpen}
                  onClick={() => setDeployOpen((v) => !v)}
                >
                  <Rocket aria-hidden="true" />
                  {t('deploy')}
                </Button>
              ) : (
                <span title={t('availableOnceGenerated')} className="inline-flex">
                  <Button variant="gold" size="sm" disabled aria-disabled="true">
                    <Rocket aria-hidden="true" />
                    {t('deploy')}
                  </Button>
                </span>
              )}
            </div>
          </div>
        </header>

        {/* ── Cours archivé (rétention P79) : bandeau + réactivation ─── */}
        {course.archived && <ArchivedBanner courseId={course.id} />}

        {/* ── Validation d'équipe (P138), workspace avec reviewer(s) ─── */}
        {course.workspace && course.workspace.hasReviewer && (
          <TeamApprovalBanner
            courseId={course.id}
            role={course.workspace.role}
            approvedBy={course.approvedBy}
            approvedAt={course.approvedAt}
          />
        )}

        {/* ── Timeline de génération (cours en production) ─────── */}
        {course.status === 'generating' && <ProgressBanner courseId={course.id} />}

        {/* ── Mode validation étape par étape : relire puis continuer ── */}
        {course.status === 'generating' && course.generationMode === 'validated' && (
          <ValidationContinueBanner courseId={course.id} sections={course.sections} />
        )}

        {/* ── Vidéo d'intro webcam (compliance max Udemy, P48) ─── */}
        {deployable && <IntroVideoUpload courseId={course.id} />}

        {/* ── Orchestrateur de déploiement (P44), sur demande ──── */}
        {deployable && deployOpen && (
          <DeployPanel
            courseId={course.id}
            lessonCount={lessonCount}
            qualityScore={course.qualityScore?.score ?? null}
          />
        )}

        {/* ── Révision / correction automatique du cours (2026-07-26) :
            placée en tête pour être immédiatement visible (détecte + répare
            leçons, images, audio, captures). ─ */}
        <ReviewPanel
          courseId={course.id}
          report={course.reviewReport}
          disabled={course.status !== 'ready' && course.status !== 'published'}
        />

        {/* ── Rapport de contrôle qualité (P26), une fois exécuté ─ */}
        {course.qaReport && <QaReportPanel report={course.qaReport} />}

        {/* ── Score de qualité pédagogique (P94), une fois évalué ─ */}
        <QualityScorePanel qualityScore={course.qualityScore} />

        {/* ── Retours étudiants (P62), dès que le cours est diffusable ─ */}
        <FeedbackPanel courseId={course.id} feedback={course.feedback} reviewable={deployable} />

        {/* ── Ressources téléchargeables (P65), une fois générées ─ */}
        <ResourcesPanel resources={course.resources} />

        {/* ── Réutilisation du contenu (P197/201/202/203) ─ */}
        <RepurposingPanel repurposing={course.repurposing} />

        {/* ── Image de couverture (2026-07-26) : hero généré ou upload ─ */}
        <CoverPanel courseId={course.id} initialUrl={course.marketing?.heroCoverUrl} />

        {/* ── Thème visuel (catalogue 2026-07-26) : pastilles + re-rendu ─ */}
        <ThemeSwitcherPanel
          courseId={course.id}
          themeId={course.themeId}
          disabled={course.status === 'generating' || course.status === 'outline-review'}
        />

        {/* ── Kit marketing (Prompt 28) : textes SEO + visuels générés ─ */}
        <MarketingKitPanel marketing={course.marketing} />

        {/* ── Blog SEO (P204), cours publié sur le LMS ─ */}
        <BlogPanel courseId={course.id} blog={course.blog} />

        {/* ── Prévisualisation vidéo rapide (P133), leçons vidéo générées ─ */}
        <QuickPreviewPanel
          courseId={course.id}
          videoLessons={allLessons.filter((lesson) => lesson.type === 'video' && lesson.assets.videoUrl)}
        />

        {/* ── Traduction du cours publié (P92), cours déjà déployé ─ */}
        {course.status === 'published' && (
          <TranslatePanel
            courseId={course.id}
            sourceLocale={course.locale}
            dubbedVersions={course.dubbedVersions ?? []}
          />
        )}

        {/* ── Arborescence + panneau de prévisualisation ───────── */}
        {course.sections.length === 0 ? (
          <EmptyState
            title={
              course.status === 'generating'
                ? t('emptyGeneratingTitle')
                : t('emptyNoSectionTitle')
            }
            description={
              course.status === 'generating'
                ? t('emptyGeneratingDescription')
                : course.status === 'failed'
                  ? t('emptyFailedDescription')
                  : t('emptyDefaultDescription')
            }
          />
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(280px,340px)_1fr]">
            <div className="rounded-lg border border-border bg-surface p-4 shadow-sm lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto">
              <LessonTree
                sections={course.sections}
                selectedId={selected?.id ?? null}
                onSelect={setSelectedId}
              />
              {/* Ajout de contenu à un cours DÉJÀ généré (2026-07-26) : une
                  nouvelle vidéo/article/TP/quiz en fin de section, générée par
                  le pipeline sans toucher au reste. */}
              <div className="mt-3 border-t border-border pt-3">
                <AddLessonButton
                  courseId={course.id}
                  sections={course.sections.map((s) => ({ id: s.id, title: s.title }))}
                  disabled={course.status === 'generating' || course.status === 'outline-review'}
                />
              </div>
            </div>
            <LessonPanel
              lesson={selected}
              locale={course.locale}
              courseId={course.id}
              showComments={Boolean(course.workspace)}
            />
          </div>
        )}
      </div>
      <Toaster />
    </ToastProvider>
  );
}
