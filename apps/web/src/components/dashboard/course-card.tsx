'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Copy,
  Eye,
  Globe,
  GraduationCap,
  MoreVertical,
  PencilLine,
  RefreshCw,
  Trash2,
  Youtube,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  useToast,
} from '@/components/ui';
import { transitions } from '@/components/motion';
import { cn } from '@/lib/cn';
import { deleteCourse, renameCourse } from '@/app/actions/courses';
import { CourseThumbnail } from './course-thumbnail';
import { ProgressRing } from './progress-ring';
import { PLATFORM_LABELS, type DashboardCourse, type PlatformId } from './mock-data';
import type { CourseStatus, Difficulty } from '@sallycourse/shared';

/**
 * Carte de cours riche — miniature générée seedée par le titre, anneau de
 * progression, badges de statut/plateformes et menu contextuel branché sur
 * les actions serveur (renommer, supprimer avec confirmation).
 */

/** Statut métier → variante de Badge + libellé français. */
const STATUS_BADGE: Record<CourseStatus, { variant: 'draft' | 'generating' | 'ready' | 'failed' | 'published'; label: string }> = {
  draft: { variant: 'draft', label: 'Brouillon' },
  generating: { variant: 'generating', label: 'Génération' },
  'outline-review': { variant: 'draft', label: 'Plan à valider' },
  ready: { variant: 'ready', label: 'Prêt' },
  published: { variant: 'published', label: 'Publié' },
  failed: { variant: 'failed', label: 'Échec' },
};

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: 'Débutant',
  intermediate: 'Intermédiaire',
  advanced: 'Avancé',
};

const PLATFORM_ICONS: Record<PlatformId, React.ComponentType<{ className?: string }>> = {
  udemy: GraduationCap,
  youtube: Youtube,
  site: Globe,
};

type MenuActionId = 'open' | 'rename' | 'duplicate' | 'retry' | 'delete';

interface MenuAction {
  id: MenuActionId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  danger?: boolean;
}

/** Actions proposées selon le statut (relancer uniquement après un échec). */
function menuActionsFor(status: CourseStatus): MenuAction[] {
  const base: MenuAction[] = [
    { id: 'open', label: 'Ouvrir le cours', icon: Eye },
    { id: 'rename', label: 'Renommer', icon: PencilLine },
    { id: 'duplicate', label: 'Dupliquer', icon: Copy },
  ];
  if (status === 'failed') base.push({ id: 'retry', label: 'Relancer la génération', icon: RefreshCw });
  base.push({ id: 'delete', label: 'Supprimer', icon: Trash2, danger: true });
  return base;
}

/** Menu contextuel maison — Échap, clic extérieur, rôles ARIA menu/menuitem. */
function CourseContextMenu({
  course,
  onAction,
}: {
  course: DashboardCourse;
  onAction: (id: MenuActionId) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const actions = menuActionsFor(course.status);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions pour « ${course.title} »`}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-sm text-muted',
          'transition-colors duration-fast hover:bg-primary-soft hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80',
          open && 'bg-primary-soft text-foreground',
        )}
      >
        <MoreVertical className="size-4" aria-hidden="true" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label={`Actions — ${course.title}`}
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -2 }}
            transition={transitions.springSnappy}
            className={cn(
              'absolute bottom-full end-0 z-20 mb-2 w-56 origin-bottom rounded-md border border-border',
              'bg-surface p-1.5 shadow-xl',
            )}
          >
            {actions.map((action) => (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onAction(action.id);
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-start text-sm',
                  'transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80',
                  action.danger
                    ? 'text-danger hover:bg-danger/10'
                    : 'text-foreground hover:bg-primary-soft',
                )}
              >
                <action.icon className="size-4 shrink-0 opacity-70" aria-hidden="true" />
                {action.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export interface CourseCardProps {
  course: DashboardCourse;
  className?: string;
}

export function CourseCard({ course, className }: CourseCardProps) {
  const status = STATUS_BADGE[course.status];
  const hasContent = course.lessonsCount > 0;

  const { toast } = useToast();
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const handleAction = (id: string): void => {
    if (id === 'rename') setRenameOpen(true);
    else if (id === 'delete') setDeleteOpen(true);
    else toast({ title: 'Bientôt disponible', description: 'Cette action arrive dans une prochaine version.' });
  };

  /** Renommage — action serveur puis toast ; la liste est revalidée côté serveur. */
  const handleRename = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const title = String(new FormData(event.currentTarget).get('title') ?? '').trim();
    if (title === course.title) {
      setRenameOpen(false);
      return;
    }
    startTransition(async () => {
      const result = await renameCourse(course.id, title);
      if (result.ok) {
        setRenameOpen(false);
        toast({ title: 'Cours renommé', description: `« ${title} »`, variant: 'success' });
      } else {
        toast({ title: 'Renommage impossible', description: result.error, variant: 'danger' });
      }
    });
  };

  /** Suppression — cascade côté serveur (sections, leçons, quiz, jobs). */
  const handleDelete = (): void => {
    startTransition(async () => {
      const result = await deleteCourse(course.id);
      if (result.ok) {
        setDeleteOpen(false);
        toast({ title: 'Cours supprimé', description: `« ${course.title} » et son contenu ont été supprimés.`, variant: 'success' });
      } else {
        toast({ title: 'Suppression impossible', description: result.error, variant: 'danger' });
      }
    });
  };

  // Pas d'overflow-hidden sur la carte : le menu contextuel dépasse du cadre.
  return (
    <Card interactive wrapperClassName={cn('h-full', className)} className="flex flex-col p-0">
      {/* Miniature générée + overlays */}
      <div className="relative aspect-video w-full overflow-hidden rounded-t-[calc(1rem-1px)]">
        <CourseThumbnail
          title={course.title}
          className="transition-transform duration-slow ease-standard group-hover/card:scale-105"
        />
        {/* Statut — coin haut fin de ligne */}
        <div className="absolute end-2.5 top-2.5">
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>
        {/* Plateformes ciblées — coin haut début de ligne */}
        {course.platforms.length > 0 && (
          <div className="absolute start-2.5 top-2.5 flex items-center gap-1.5">
            {course.platforms.map((platform) => {
              const Icon = PLATFORM_ICONS[platform];
              return (
                <span
                  key={platform}
                  title={PLATFORM_LABELS[platform]}
                  className="flex h-6 w-6 items-center justify-center rounded-full border border-border/60 bg-neutral-950/70 text-neutral-100 backdrop-blur-sm"
                >
                  <Icon className="size-3.5" aria-hidden="true" />
                  <span className="sr-only">{PLATFORM_LABELS[platform]}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Corps */}
      <div className="flex flex-1 flex-col gap-3 p-5">
        <h3 className="line-clamp-2 font-display text-lg font-semibold leading-snug text-foreground">
          {course.title}
        </h3>

        <p className="text-xs text-muted">
          <span className="font-medium text-foreground/80">{DIFFICULTY_LABELS[course.difficulty]}</span>
          {hasContent && (
            <>
              {' · '}
              {course.sectionsCount} sections · {course.lessonsCount} leçons ·{' '}
              <span className="tabular-nums">{Math.floor(course.durationMin / 60)} h {course.durationMin % 60} min</span>
            </>
          )}
          {!hasContent && course.sectionsCount > 0 && <> · {course.sectionsCount} sections planifiées</>}
        </p>

        {/* Pied : anneau de progression + fraîcheur + menu contextuel */}
        <div className="mt-auto flex items-center gap-3 border-t border-border pt-3.5">
          <ProgressRing value={course.progress} label={`Génération de « ${course.title} »`} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-foreground">
              {course.progress === 100 ? 'Génération terminée' : `Généré à ${course.progress} %`}
            </p>
            <p className="truncate text-2xs text-muted">{course.updatedAtLabel}</p>
          </div>
          <CourseContextMenu course={course} onAction={handleAction} />
        </div>
      </div>

      {/* Dialogue de renommage */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <form onSubmit={handleRename} className="flex flex-col gap-5">
            <DialogHeader>
              <DialogTitle>Renommer le cours</DialogTitle>
              <DialogDescription>Le nouveau titre sera utilisé partout (dashboard, exports, publication).</DialogDescription>
            </DialogHeader>
            <Input
              label="Titre du cours"
              name="title"
              defaultValue={course.title}
              minLength={3}
              maxLength={120}
              required
              autoFocus
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setRenameOpen(false)} disabled={pending}>
                Annuler
              </Button>
              <Button type="submit" loading={pending}>
                Renommer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialogue de confirmation de suppression */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer ce cours ?</DialogTitle>
            <DialogDescription>
              « {course.title} » ainsi que toutes ses sections, leçons, quiz et jobs de génération seront
              définitivement supprimés. Cette action est irréversible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDeleteOpen(false)} disabled={pending}>
              Annuler
            </Button>
            <Button type="button" variant="danger" loading={pending} onClick={handleDelete}>
              <Trash2 aria-hidden="true" />
              Supprimer définitivement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
