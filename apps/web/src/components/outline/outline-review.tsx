'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  CalendarDays,
  GraduationCap,
  Languages,
  ListChecks,
  RefreshCw,
  Sparkles,
  Video,
} from 'lucide-react';
import { Badge, Button, ToastProvider, Toaster, useToast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { approveOutlinePayloadSchema, type ApproveOutlinePayload } from '@/lib/outline-payload';
import { useAutosave, autosaveStatusLabel } from '@/hooks/use-autosave';
import { clearLocalDraft, readLocalDraft, shouldOfferRecovery, writeLocalDraft } from '@/hooks/local-draft';
import { useDirtyState } from '../course/edit/use-dirty-state';
import { OutlineEditor } from './outline-editor';
import { RegenerateDialog } from './regenerate-dialog';
import { toEditorSections, type Difficulty, type EditorSection, type Locale, type OutlineReviewCourse } from './types';

/**
 * Écran de validation du plan (Course.status = 'outline-review') : en-tête du
 * cours, éditeur drag-and-drop du plan, statistiques temps réel et actions
 * « Valider et générer le contenu » / « Régénérer le plan ».
 */

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: 'Débutant',
  intermediate: 'Intermédiaire',
  advanced: 'Avancé',
};

const LOCALE_LABELS: Record<Locale, string> = {
  fr: 'Français',
  en: 'English',
  ar: 'العربية',
};

// Minimums Udemy — alignés sur UDEMY de @sallycourse/shared (baril non
// importable côté client : node:crypto / aws-sdk).
const UDEMY_MIN_SECTIONS = 5;
const UDEMY_MIN_TOTAL_VIDEO_MINUTES = 30;

export interface OutlineReviewProps {
  course: OutlineReviewCourse;
}

export function OutlineReview({ course }: OutlineReviewProps) {
  return (
    <ToastProvider>
      <OutlineReviewInner course={course} />
      <Toaster />
    </ToastProvider>
  );
}

function OutlineReviewInner({ course }: OutlineReviewProps) {
  const router = useRouter();
  const { toast } = useToast();
  const draftScope = `outline:${course.id}`;

  const initialSections = React.useMemo(() => toEditorSections(course.sections), [course.sections]);

  const [sections, setSections] = React.useState<EditorSection[]>(() => {
    // Récupération d'un brouillon local (P131) : le plan n'a pas de
    // sauvegarde serveur incrémentale (seule « Valider » persiste), donc
    // l'autosave et la protection contre la perte reposent entièrement sur
    // localStorage ici.
    const draft = readLocalDraft<EditorSection[]>(draftScope);
    if (draft && shouldOfferRecovery(draft, initialSections)) return draft.value;
    return initialSections;
  });
  const [recovered] = React.useState(() => {
    const draft = readLocalDraft<EditorSection[]>(draftScope);
    return Boolean(draft && shouldOfferRecovery(draft, initialSections));
  });
  const [approving, setApproving] = React.useState(false);
  const [regenerateOpen, setRegenerateOpen] = React.useState(false);
  const [regenerating, setRegenerating] = React.useState(false);

  // Clés dnd-kit des éléments ajoutés — compteur en ref : déterministe et
  // sans collision avec les _id Mongo utilisés pour les éléments existants.
  const keyCounter = React.useRef(0);
  const nextKey = React.useCallback(() => `new-${++keyCounter.current}`, []);

  // Autosave locale uniquement : pas d'endpoint de sauvegarde partielle du
  // plan côté serveur, on protège seulement contre une perte de saisie
  // (fermeture d'onglet, crash) via un brouillon localStorage.
  const persistLocally = React.useCallback(
    (value: EditorSection[]) => {
      writeLocalDraft(draftScope, value);
    },
    [draftScope],
  );
  const autosave = useAutosave(sections, persistLocally, { delayMs: 2000 });
  // beforeunload : le plan n'est jamais persisté côté serveur avant
  // « Valider » — dirty compare à la version chargée au montage (et non à
  // la dernière écriture localStorage, qui elle-même n'est qu'un filet).
  const dirty = useDirtyState(sections, initialSections);

  // ── Statistiques temps réel du plan ────────────────────────────
  const stats = React.useMemo(() => {
    const lessons = sections.flatMap((section) => section.lessons);
    const videoMinutes = lessons
      .filter((lesson) => lesson.type === 'video')
      .reduce((total, lesson) => total + (lesson.durationMin || 0), 0);
    return { sections: sections.length, lessons: lessons.length, videoMinutes };
  }, [sections]);

  const sectionsOk = stats.sections >= UDEMY_MIN_SECTIONS;
  const videoOk = stats.videoMinutes >= UDEMY_MIN_TOTAL_VIDEO_MINUTES;

  // ── Validation + génération du contenu ─────────────────────────
  const approve = async () => {
    const payload: ApproveOutlinePayload = {
      sections: sections.map((section) => ({
        title: section.title.trim(),
        lessons: section.lessons.map((lesson) => ({
          title: lesson.title.trim(),
          type: lesson.type,
          durationMin: lesson.durationMin,
          summary: lesson.summary,
        })),
      })),
    };

    const checked = approveOutlinePayloadSchema.safeParse(payload);
    if (!checked.success) {
      const first = checked.error.issues[0];
      toast({
        variant: 'warning',
        title: 'Plan incomplet',
        description: first?.message ?? 'Vérifiez les titres et les durées avant de valider.',
      });
      return;
    }

    setApproving(true);
    try {
      const response = await fetch(`/api/courses/${course.id}/approve-outline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(checked.data),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        toast({
          variant: 'danger',
          title: 'Validation impossible',
          description: data.error ?? 'Une erreur est survenue, réessayez.',
        });
        return;
      }
      toast({
        variant: 'success',
        title: 'Plan validé',
        description: 'La génération du contenu de chaque leçon démarre.',
      });
      clearLocalDraft(draftScope); // Plan persisté côté serveur : le brouillon local est obsolète.
      router.refresh();
    } catch {
      toast({ variant: 'danger', title: 'Erreur réseau', description: 'Impossible de joindre le serveur.' });
    } finally {
      setApproving(false);
    }
  };

  // ── Régénération du plan avec consignes ────────────────────────
  const regenerate = async (extraInstructions: string) => {
    setRegenerating(true);
    try {
      const response = await fetch(`/api/courses/${course.id}/regenerate-outline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(extraInstructions ? { extraInstructions } : {}),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        toast({
          variant: 'danger',
          title: 'Régénération impossible',
          description: data.error ?? 'Une erreur est survenue, réessayez.',
        });
        return;
      }
      setRegenerateOpen(false);
      toast({
        variant: 'success',
        title: 'Nouveau plan en préparation',
        description: 'Le plan sera régénéré avec vos consignes dans quelques instants.',
      });
      router.refresh();
    } catch {
      toast({ variant: 'danger', title: 'Erreur réseau', description: 'Impossible de joindre le serveur.' });
    } finally {
      setRegenerating(false);
    }
  };

  const createdAt = new Date(course.createdAt);
  const busy = approving || regenerating;
  const autosaveLabel = autosaveStatusLabel(autosave.status, autosave.lastSavedAt);

  return (
    <div className="flex flex-col gap-8">
      {/* ── En-tête du cours ─────────────────────────────────────── */}
      <header className="flex flex-col gap-4">
        <Link
          href="/dashboard"
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted transition-colors duration-fast hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Retour au dashboard
        </Link>

        {recovered && (
          <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            Un brouillon de plan non validé a été retrouvé sur cet appareil et rechargé.
          </p>
        )}

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">
                {course.title}
              </h1>
              <Badge variant="draft">Plan à valider</Badge>
              {dirty && (
                <span className="text-2xs font-semibold uppercase tracking-wide text-accent-500">
                  • non validé
                </span>
              )}
              {!dirty ? null : autosave.status === 'saving' ? (
                <span className="text-2xs uppercase tracking-wide text-muted">Enregistrement…</span>
              ) : (
                autosaveLabel && (
                  <span className="text-2xs uppercase tracking-wide text-muted">
                    Brouillon local · {autosaveLabel}
                  </span>
                )
              )}
            </div>
            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
              <span className="inline-flex items-center gap-1.5">
                <GraduationCap className="size-4" aria-hidden="true" />
                {DIFFICULTY_LABELS[course.difficulty]}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Languages className="size-4" aria-hidden="true" />
                {LOCALE_LABELS[course.locale]}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="size-4" aria-hidden="true" />
                Créé le{' '}
                {createdAt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
              </span>
            </p>
          </div>

          {/* Actions principales */}
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => setRegenerateOpen(true)}
            >
              <RefreshCw aria-hidden="true" />
              Régénérer le plan
            </Button>
            <Button variant="gold" size="sm" loading={approving} disabled={busy} onClick={approve}>
              {!approving && <Sparkles aria-hidden="true" />}
              Valider et générer le contenu
            </Button>
          </div>
        </div>
      </header>

      {/* ── Bandeau statistiques du plan ─────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border bg-surface px-4 py-3 shadow-sm">
        <p className="me-auto text-sm text-muted">
          Ajustez le plan proposé — glissez-déposez, renommez, modifiez les types — puis validez
          pour lancer la génération du contenu.
        </p>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 text-sm tabular-nums',
            sectionsOk ? 'text-foreground' : 'text-danger',
          )}
          title={sectionsOk ? undefined : `Udemy recommande au moins ${UDEMY_MIN_SECTIONS} sections`}
        >
          <ListChecks className="size-4" aria-hidden="true" />
          {stats.sections} section{stats.sections > 1 ? 's' : ''} · {stats.lessons} leçon
          {stats.lessons > 1 ? 's' : ''}
        </span>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 text-sm tabular-nums',
            videoOk ? 'text-foreground' : 'text-danger',
          )}
          title={videoOk ? undefined : `Udemy exige au moins ${UDEMY_MIN_TOTAL_VIDEO_MINUTES} minutes de vidéo`}
        >
          <Video className="size-4" aria-hidden="true" />~{stats.videoMinutes} min de vidéo
        </span>
      </div>

      {/* ── Éditeur drag-and-drop ────────────────────────────────── */}
      <OutlineEditor sections={sections} setSections={setSections} nextKey={nextKey} />

      <RegenerateDialog
        open={regenerateOpen}
        onOpenChange={setRegenerateOpen}
        onConfirm={regenerate}
        pending={regenerating}
      />
    </div>
  );
}
