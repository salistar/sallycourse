'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, ExternalLink, Plus, Sparkles, Trash2, X } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Select,
  Textarea,
  useToast,
} from '@/components/ui';
import { errorMessage } from '@/lib/error-message';

/**
 * Éditeur de parcours (Prompt 199) : composition à partir des cours DÉJÀ
 * publiés sur le LMS interne (choix, ordre, verrous de prérequis), prix bundle,
 * publication et génération de la page de vente. Toutes les écritures passent
 * par /api/paths* (ownership vérifié côté serveur) ; l'état serveur est
 * rafraîchi via router.refresh() après chaque mutation.
 */

/** Cours publié de l'auteur, éligible à un parcours. */
export interface PathEditorCourse {
  courseId: string;
  title: string;
  priceCents: number;
}

export interface PathEditorPathCourse {
  courseId: string;
  requiresPrevious: boolean;
}

export interface PathEditorPath {
  id: string;
  title: string;
  slug: string;
  description: string;
  priceCents: number;
  currency: string;
  published: boolean;
  hasSalesPage: boolean;
  courses: PathEditorPathCourse[];
}

export interface PathEditorProps {
  paths: PathEditorPath[];
  availableCourses: PathEditorCourse[];
  currencies: readonly string[];
}

/** Déplace un élément d'un cran (haut/bas) — renvoie une NOUVELLE liste. */
function move<T>(items: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved!);
  return next;
}

/** Liste ordonnée éditable de cours (ordre + verrou de prérequis). */
function CourseList({
  courses,
  titleOf,
  onChange,
}: {
  courses: PathEditorPathCourse[];
  titleOf: (courseId: string) => string;
  onChange: (courses: PathEditorPathCourse[]) => void;
}) {
  const t = useTranslations('paths');

  return (
    <ol className="flex list-none flex-col gap-2 p-0">
      {courses.map((course, index) => (
        <li
          key={course.courseId}
          className="flex flex-wrap items-center gap-3 rounded-sm border border-border bg-surface-subtle/50 px-3 py-2"
        >
          <span className="text-xs font-semibold text-muted">{index + 1}.</span>
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">
            {titleOf(course.courseId)}
          </span>

          {/* Le premier cours n'a pas de précédent : le verrou n'a aucun sens. */}
          {index > 0 && (
            <label className="flex items-center gap-1.5 text-2xs text-muted">
              <input
                type="checkbox"
                checked={course.requiresPrevious}
                onChange={(event) =>
                  onChange(
                    courses.map((c, i) =>
                      i === index ? { ...c, requiresPrevious: event.target.checked } : c,
                    ),
                  )
                }
              />
              {t('requiresPrevious')}
            </label>
          )}

          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('moveUp')}
              disabled={index === 0}
              onClick={() => onChange(move(courses, index, -1))}
            >
              <ArrowUp aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('moveDown')}
              disabled={index === courses.length - 1}
              onClick={() => onChange(move(courses, index, 1))}
            >
              <ArrowDown aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('remove')}
              onClick={() => onChange(courses.filter((_, i) => i !== index))}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Sélecteur « ajouter un cours » — n'expose que les cours pas encore chaînés. */
function AddCourseSelect({
  availableCourses,
  selectedIds,
  onAdd,
}: {
  availableCourses: PathEditorCourse[];
  selectedIds: string[];
  onAdd: (courseId: string) => void;
}) {
  const t = useTranslations('paths');
  const remaining = availableCourses.filter((c) => !selectedIds.includes(c.courseId));
  if (remaining.length === 0) return null;

  return (
    <div className="flex items-end gap-2">
      <Select
        label={t('addCourse')}
        value=""
        onChange={(event) => {
          if (event.target.value) onAdd(event.target.value);
        }}
        wrapperClassName="flex-1"
      >
        <option value="">—</option>
        {remaining.map((course) => (
          <option key={course.courseId} value={course.courseId}>
            {course.title}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function PathEditor({ paths, availableCourses, currencies }: PathEditorProps) {
  const t = useTranslations('paths');
  const tApiError = useTranslations('apiErrors');
  const router = useRouter();
  const { toast } = useToast();
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  const titleOf = React.useCallback(
    (courseId: string) =>
      availableCourses.find((course) => course.courseId === courseId)?.title ?? courseId,
    [availableCourses],
  );

  /** Appel API + toast d'erreur homogène ; true si la mutation a réussi. */
  async function call(url: string, init: RequestInit, key: string): Promise<boolean> {
    setPendingId(key);
    try {
      const response = await fetch(url, init);
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        toast({ variant: 'danger', title: errorMessage(data, tApiError) });
        return false;
      }
      router.refresh();
      return true;
    } catch {
      toast({ variant: 'danger', title: 'Erreur réseau' });
      return false;
    } finally {
      setPendingId(null);
    }
  }

  if (availableCourses.length === 0) {
    return <EmptyState title={t('noPublishedCourses')} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <CreatePathForm
        availableCourses={availableCourses}
        currencies={currencies}
        titleOf={titleOf}
        pending={pendingId === 'create'}
        onSubmit={(payload) =>
          call(
            '/api/paths',
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            },
            'create',
          )
        }
      />

      {paths.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        paths.map((path) => (
          <ExistingPathCard
            key={path.id}
            path={path}
            availableCourses={availableCourses}
            currencies={currencies}
            titleOf={titleOf}
            pendingKey={pendingId}
            onSave={(payload) =>
              call(
                `/api/paths/${path.id}`,
                {
                  method: 'PATCH',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify(payload),
                },
                `save-${path.id}`,
              )
            }
            onDelete={() => call(`/api/paths/${path.id}`, { method: 'DELETE' }, `delete-${path.id}`)}
            onGenerate={async () => {
              const ok = await call(
                `/api/paths/${path.id}/sales-page`,
                { method: 'POST' },
                `sales-${path.id}`,
              );
              if (ok) toast({ variant: 'success', title: t('salesPageReady') });
              return ok;
            }}
          />
        ))
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Création                                                            */
/* ------------------------------------------------------------------ */

interface PathPayload {
  title: string;
  description: string;
  courses: PathEditorPathCourse[];
  priceCents: number;
  currency: string;
}

function CreatePathForm({
  availableCourses,
  currencies,
  titleOf,
  pending,
  onSubmit,
}: {
  availableCourses: PathEditorCourse[];
  currencies: readonly string[];
  titleOf: (courseId: string) => string;
  pending: boolean;
  onSubmit: (payload: PathPayload) => Promise<boolean>;
}) {
  const t = useTranslations('paths');
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [priceCents, setPriceCents] = React.useState(0);
  const [currency, setCurrency] = React.useState(currencies[0] ?? 'MAD');
  const [courses, setCourses] = React.useState<PathEditorPathCourse[]>([]);

  const canSubmit = title.trim().length >= 3 && courses.length > 0 && !pending;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    const ok = await onSubmit({ title: title.trim(), description, courses, priceCents, currency });
    if (!ok) return;
    setTitle('');
    setDescription('');
    setPriceCents(0);
    setCourses([]);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Plus className="size-5 text-accent" aria-hidden="true" /> {t('newPath')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Input
            label={t('titleField')}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            minLength={3}
            maxLength={160}
          />
          <Textarea
            label={t('descriptionField')}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={2000}
            rows={3}
          />

          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-foreground">{t('coursesField')}</p>
            <CourseList courses={courses} titleOf={titleOf} onChange={setCourses} />
            <AddCourseSelect
              availableCourses={availableCourses}
              selectedIds={courses.map((course) => course.courseId)}
              onAdd={(courseId) =>
                setCourses([...courses, { courseId, requiresPrevious: courses.length > 0 }])
              }
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label={t('priceField')}
              type="number"
              min={0}
              step={1}
              value={priceCents}
              onChange={(event) => setPriceCents(Math.max(0, Number(event.target.value) || 0))}
            />
            <Select
              label={t('currencyField')}
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
            >
              {currencies.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Button type="submit" disabled={!canSubmit} loading={pending}>
              {t('create')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Édition d'un parcours existant                                      */
/* ------------------------------------------------------------------ */

function ExistingPathCard({
  path,
  availableCourses,
  currencies,
  titleOf,
  pendingKey,
  onSave,
  onDelete,
  onGenerate,
}: {
  path: PathEditorPath;
  availableCourses: PathEditorCourse[];
  currencies: readonly string[];
  titleOf: (courseId: string) => string;
  pendingKey: string | null;
  onSave: (payload: Partial<PathPayload> & { published?: boolean }) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
  onGenerate: () => Promise<boolean>;
}) {
  const t = useTranslations('paths');
  const [courses, setCourses] = React.useState<PathEditorPathCourse[]>(path.courses);
  const [priceCents, setPriceCents] = React.useState(path.priceCents);
  const [currency, setCurrency] = React.useState(path.currency);

  // Le parcours a pu changer côté serveur (router.refresh) : on resynchronise.
  React.useEffect(() => {
    setCourses(path.courses);
    setPriceCents(path.priceCents);
    setCurrency(path.currency);
  }, [path.courses, path.priceCents, path.currency]);

  const saving = pendingKey === `save-${path.id}`;
  const deleting = pendingKey === `delete-${path.id}`;
  const generating = pendingKey === `sales-${path.id}`;
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-lg">{path.title}</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={path.published ? 'published' : 'ready'}>
              {path.published ? t('published') : t('draft')}
            </Badge>
            {path.published && (
              <Link
                href={`/paths/${path.slug}`}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <ExternalLink className="size-3.5" aria-hidden="true" /> {t('viewPublic')}
              </Link>
            )}
          </div>
        </div>
        {!path.hasSalesPage && <p className="text-xs text-muted">{t('salesPageMissing')}</p>}
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <CourseList courses={courses} titleOf={titleOf} onChange={setCourses} />
        <AddCourseSelect
          availableCourses={availableCourses}
          selectedIds={courses.map((course) => course.courseId)}
          onAdd={(courseId) =>
            setCourses([...courses, { courseId, requiresPrevious: courses.length > 0 }])
          }
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label={t('priceField')}
            type="number"
            min={0}
            step={1}
            value={priceCents}
            onChange={(event) => setPriceCents(Math.max(0, Number(event.target.value) || 0))}
          />
          <Select
            label={t('currencyField')}
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
          >
            {currencies.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            loading={saving}
            disabled={saving || courses.length === 0}
            onClick={() => onSave({ courses, priceCents, currency })}
          >
            {t('save')}
          </Button>

          <Button
            type="button"
            variant={path.published ? 'ghost' : 'primary'}
            disabled={saving || courses.length === 0}
            onClick={() => onSave({ published: !path.published })}
          >
            {path.published ? t('unpublish') : t('publish')}
          </Button>

          <Button
            type="button"
            variant="gold"
            loading={generating}
            disabled={generating || path.courses.length === 0}
            onClick={onGenerate}
          >
            <Sparkles aria-hidden="true" />
            {generating ? t('generating') : t('generateSalesPage')}
          </Button>

          <Button
            type="button"
            variant="danger"
            loading={deleting}
            disabled={deleting}
            onClick={() => setConfirmOpen(true)}
            className="ms-auto"
          >
            <Trash2 aria-hidden="true" /> {t('delete')}
          </Button>
        </div>

        {/* Confirmation : la suppression purge aussi la progression des inscrits. */}
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('deleteConfirmTitle')}</DialogTitle>
              <DialogDescription>{t('deleteConfirmBody')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setConfirmOpen(false)} disabled={deleting}>
                {t('cancel')}
              </Button>
              <Button
                type="button"
                variant="danger"
                loading={deleting}
                onClick={() => {
                  void onDelete().then((ok) => {
                    if (ok) setConfirmOpen(false);
                  });
                }}
              >
                <Trash2 aria-hidden="true" /> {t('confirmDelete')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
